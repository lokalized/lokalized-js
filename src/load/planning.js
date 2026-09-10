// @ts-check
/**
 * `chain` and `fetchSet` — plan section 6.1's two planning functions.
 *
 * THEY PLAN, THEY DO NOT NEGOTIATE. The plan says it twice and it is the easiest thing to get wrong:
 * "chain and fetchSet do not negotiate or substitute a diagnostic selection: they plan from that
 * exact input through the fallback sequence and manifest candidate-resolution rules in 2.2". A
 * matcher answers "which of these locales is the best fit"; a planner answers "if I resolve from
 * THIS tag, what would I attempt, in order". `matchFor` and the candidate chain legitimately disagree
 * — that is a MEASURED invariant of this port's resolution core, not an edge case — so reaching for
 * the matcher here would produce plausible answers that are wrong for a whole class of input.
 *
 * THE SEQUENCE IS NOT REIMPLEMENTED HERE, and that is the important design decision. Plan 2.2's
 * candidate rules are already implemented by `candidateChain` in `src/internal/locale.js`, and that
 * implementation is verified against the real Java library — through 416 corpus cases carrying
 * `attemptedLocales`, and through `diff:lookup`'s end-to-end comparison. A second implementation for
 * the manifest door would be a second thing to keep in step with Java, and the one that drifts is the
 * one with less coverage. So this module supplies the manifest PROJECTION and nothing else.
 *
 * WHAT THAT MEANS FOR THIS SLICE'S ORACLE, stated plainly because it is easy to overclaim: the
 * candidate SEQUENCE has a Java oracle by inheritance. The projection on top of it — which candidates
 * are manifest-backed, what a `FetchEntry` looks like, how a file URL resolves against `baseUrl` —
 * has NONE. Java has no manifest, no file URLs and no fetch set. `test/planning.test.js` labels every
 * expectation with which of the two it rests on.
 *
 * AND THE NON-GATE, recorded so a later reader does not mistake it for evidence: comparing this
 * module against core's `candidateChain` would be a probe space derived from the thing under test. It
 * would prove self-consistency and nothing else, because this module CALLS that function.
 */
import { candidateChain } from "../internal/locale.js";
import { normalizeTag } from "../internal/locale.js";
import { validateStringsManifest } from "./manifest.js";

/** @typedef {import("./index.js").StringsManifestV1} StringsManifestV1 */
/** @typedef {import("./index.js").FetchEntry} FetchEntry */

/**
 * The candidates a lookup would attempt, in order — INCLUDING those the manifest cannot serve.
 *
 * Plan 6.1: "chain includes attempted candidates without files." A candidate that resolves to no file
 * stays in the list as its own normalized tag, because it was still attempted: a caller reasoning
 * about coverage needs to see the locale that was tried and missed, not a list silently narrowed to
 * the ones that happened to exist.
 *
 * @param {StringsManifestV1} manifest
 * @param {string} lookupLocale any input that normalizes to a well-formed tag
 * @param {{ limits?: import("../internal/catalog.js").ParseLimits }} [options]
 * @returns {readonly string[]}
 */
export function chain(manifest, lookupLocale, options = {}) {
  const validated = validateStringsManifest(manifest, options);
  // Normalized once, here, and it is the normalized serialized value that is planned from and
  // recorded — plan 6.1: "both functions use and record the normalized serialized value".
  const lookup = normalizeTag(lookupLocale);
  return Object.freeze(
    candidateChain(lookup, Object.keys(validated.files), validated.fallbackLocale, validated.tiebreakers),
  );
}

/**
 * The files a lookup would actually fetch, in first-use order.
 *
 * Plan 6.1: "fetchSet contains only manifest-backed files, deduplicated in first-use order." The
 * dedup is already first-wins on the POST-RESOLUTION tag inside the candidate walk — two candidates
 * that resolve to one file collapse there — so this filter does not re-deduplicate; it selects. Said
 * out loud because a second dedup here would be dead code that LOOKS like the rule being enforced,
 * and a later reader could delete the real one without any test noticing.
 *
 * @param {StringsManifestV1} manifest
 * @param {string} lookupLocale
 * @param {{ limits?: import("../internal/catalog.js").ParseLimits }} [options]
 * @returns {readonly FetchEntry[]}
 */
export function fetchSet(manifest, lookupLocale, options = {}) {
  const validated = validateStringsManifest(manifest, options);
  const base = new URL(validated.baseUrl);

  /** @type {FetchEntry[]} */
  const entries = [];
  for (const tag of chain(validated, lookupLocale, options)) {
    const file = validated.files[tag];
    if (file === undefined) continue;
    entries.push(/** @type {FetchEntry} */ (Object.freeze({
      locale: tag,
      // Plan 6.1: "Each file URL is resolved with `new URL(file.url, manifest.baseUrl)`", and the
      // entry carries the ABSOLUTE serialized result, so nothing downstream resolves it a second
      // time against a base it may no longer have.
      url: new URL(file.url, base).href,
      sha256: file.sha256,
      ...(file.decodedBytes === undefined ? {} : { expectedDecodedBytes: file.decodedBytes }),
    })));
  }
  return Object.freeze(entries);
}
