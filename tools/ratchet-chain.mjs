// @ts-check
/**
 * A ratchet's history, chained so that it survives the record it lives in.
 *
 * **THE HOLE THIS CLOSES.** A ratchet compares a new measurement with the one its record holds, so
 * deleting the record and writing a fresh one resets it to whatever the tree measures today — a grown
 * figure recorded as if it were the first. `RECIPE_DIGESTS` in `tools/0b-recipe.mjs` closed the same
 * hole for a recipe by freezing each revision's digest in SOURCE; this does it for a history. Each
 * entry names the digest of the one before it, and the digest of the first entry is frozen in the
 * tool that owns the record. A deleted, reordered or edited entry breaks the chain — for every entry
 * BUT THE NEWEST — and a history started over does not begin where the frozen digest says it must.
 *
 * **THE NEWEST ENTRY IS NAMED BY NOTHING, SO THE CHAIN ALONE CANNOT SEE ITS OWN END.** Dropping
 * entries from the end, or editing the last one, leaves a valid chain: measured 2026-09-25 by an
 * adversarial review, a 71-entry history cut back to its first entry passed at exit 0, and so did a
 * `--write` after it. Two things answer that, and neither is complete:
 *
 *   - a CHECKPOINT, `{ index, sha256 }`, frozen in the owning tool's source beside the origin. The
 *     entry at `index` must exist and have that digest, and because each entry's digest covers the
 *     link to the one before it, that pins EVERY entry up to it. Entries appended after it are held
 *     by the chain alone until somebody moves the checkpoint forward — a deliberate edit, which
 *     `scenario-0a.mjs`, `subpath-graphs.mjs` and `scenario-6.mjs` report every run rather than gate,
 *     so a routine re-record there does not also need a source edit, and which `0b-checks.mjs` and
 *     `scenarios-1-5/check.mjs` GATE: their checkpoint must name the newest entry;
 *   - FIGURES BOUND TO THE NEWEST ENTRY (`figureProblems`): each entry records the figures its write
 *     stored, and the record may hold none above them. Cutting entries off the end leaves a newest
 *     entry that recorded smaller figures, so the record's figures are above it and fail; putting them
 *     back down makes the growth the cut entries explained fail AS GROWTH, which needs a reason again.
 *     What can still be lost after the checkpoint is the reasons, not the ratchet.
 *
 * **WHAT IT CANNOT STOP** is someone editing a frozen digest in source along with the record: a
 * deliberate edit to a line whose only job is not to change, which a reviewer sees in the diff. Nor
 * an entry after the checkpoint edited consistently with the figures it binds, which only the diff
 * shows. And rolling the record back from git to an older, intact state that still reaches the
 * checkpoint is a valid chain; git shows it.
 *
 * Shared by every ratchet that keeps a history, because a second copy of a digest rule drifts —
 * `tools/graph-walk.mjs`'s reasoning.
 */
import { createHash } from "node:crypto";

/** Sorted keys at every depth, so a digest names content rather than the order a writer used. */
const canonical = (/** @type {unknown} */ value) => JSON.stringify(value, (_key, v) =>
  (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

/** The digest an entry is known by, and the one the entry after it must name. */
export const entryDigest = (/** @type {unknown} */ entry) =>
  createHash("sha256").update(canonical(entry)).digest("hex");

/**
 * `entry`, linked to the end of `history`. The link is computed, never supplied by a caller.
 * @template {object} T
 * @param {readonly object[]} history
 * @param {T} entry
 * @returns {T & { previousSha256: string | null }}
 */
export const chained = (history, entry) =>
  ({ ...entry, previousSha256: history.length > 0 ? entryDigest(history[history.length - 1]) : null });

/**
 * The checkpoint that would pin every entry of `history` as it stands: what a tool prints so that
 * moving its frozen checkpoint forward is a paste, not a computation.
 * @param {readonly object[]} history
 * @returns {{ index: number, sha256: string }}
 */
export const checkpointOf = (history) =>
  ({ index: history.length - 1, sha256: entryDigest(history[history.length - 1]) });

/**
 * Everything wrong with a chained history, in words that name the record. A hand-edited history is
 * REPORTED, never crashed on: a checker that throws reads as a red for the wrong reason, which this
 * project has mistaken for a finding more than once.
 * @param {unknown} history
 * @param {string | undefined} origin the digest of the first entry, frozen in the owning tool's source
 * @param {string} what how to name the record in a message, e.g. "measurements/scenario-0a.json"
 * @param {{ index: number, sha256: string } | undefined} [frozenThrough] the checkpoint frozen beside
 *   the origin; `undefined` pins nothing past the origin, and leaves the end of the history to the
 *   chain, which cannot see it
 * @returns {string[]}
 */
export function chainProblems(history, origin, what, frozenThrough) {
  if (!Array.isArray(history) || history.length === 0)
    return [`${what} carries no history, so nothing ratchets and absence would read as agreement`];
  if (history.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry)))
    return [`${what}'s history holds an entry that is not an object; it was edited by hand`];
  /** @type {string[]} */
  const problems = [];
  if (origin === undefined)
    problems.push(`${what}'s history has no frozen first entry; freeze "${entryDigest(history[0])}" in its tool`);
  else if (entryDigest(history[0]) !== origin || history[0].previousSha256 !== null)
    problems.push(`${what}'s history does not start at the entry frozen for it (${origin.slice(0, 12)}): ` +
      "its first entry was deleted, replaced or edited, or the history was started over. Restore the record " +
      "from git rather than writing a new one");
  for (let i = 1; i < history.length; i++)
    if (history[i].previousSha256 !== entryDigest(history[i - 1]))
      problems.push(`${what}: history entry ${i} does not follow entry ${i - 1}; an entry was deleted, reordered or edited`);
  if (frozenThrough !== undefined) {
    if (!Number.isSafeInteger(frozenThrough.index) || frozenThrough.index < 0 || typeof frozenThrough.sha256 !== "string")
      problems.push(`${what}'s tool freezes its history through ${JSON.stringify(frozenThrough)}, which is not an ` +
        "entry index and a digest");
    else if (history.length <= frozenThrough.index)
      problems.push(`${what}'s history ends at entry ${history.length - 1}, and its tool freezes it through entry ` +
        `${frozenThrough.index}: entries were cut from its end. Restore the record from git`);
    else if (entryDigest(history[frozenThrough.index]) !== frozenThrough.sha256)
      problems.push(`${what}: history entry ${frozenThrough.index} is not the entry its tool freezes ` +
        `(${frozenThrough.sha256.slice(0, 12)}); it, or an entry before it, was edited or deleted. Restore the ` +
        "record from git");
  }
  return problems;
}

const isCount = (/** @type {unknown} */ n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 0;

/**
 * The figures a record holds, against the ones its newest history entry says its write stored. A
 * ratchet's record may hold figures at or BELOW those — a shrink is always allowed to be written —
 * and never above them, never a row the entry did not record, never a row or a measure missing, and
 * never anything that is not a count. Otherwise the record's own numbers are the reset: raise one by
 * hand, or delete it so a comparison with `undefined` says nothing, and growth passes with no reason.
 * Both were measured passing at exit 0 before this existed.
 * @param {Record<string, Record<string, unknown>>} figures what the record holds, by row then measure
 * @param {unknown} recorded the newest entry's `recorded`
 * @param {string} what how to name the record in a message
 * @returns {string[]}
 */
export function figureProblems(figures, recorded, what) {
  if (!recorded || typeof recorded !== "object" || Array.isArray(recorded))
    return [`${what}'s newest history entry records no figures, so the figures the record holds are bound to ` +
      "nothing and could be raised by hand; restore the record from git"];
  const was = /** @type {Record<string, unknown>} */ (recorded);
  /** @type {string[]} */
  const problems = [];
  for (const row of new Set([...Object.keys(figures), ...Object.keys(was)])) {
    const now = figures[row];
    const then = /** @type {Record<string, unknown> | undefined} */ (was[row]);
    if (!now || typeof now !== "object") {
      problems.push(`${what} holds no ${row} row, which its newest history entry recorded; restore it from git`);
      continue;
    }
    if (!then || typeof then !== "object") {
      problems.push(`${what} holds a ${row} row its newest history entry did not record; it was added by hand`);
      continue;
    }
    for (const measure of new Set([...Object.keys(now), ...Object.keys(then)])) {
      if (!isCount(then[measure]))
        problems.push(`${what}'s newest history entry recorded ${JSON.stringify(then[measure])} for ${row} ` +
          `${measure}, which is not a count; it was edited by hand`);
      else if (!isCount(now[measure]))
        problems.push(`${what}: ${row} ${measure} is ${JSON.stringify(now[measure])}, not a count; restore it from git`);
      else if (/** @type {number} */ (now[measure]) > /** @type {number} */ (then[measure]))
        problems.push(`${what}: ${row} ${measure} is ${now[measure]}, above the ${then[measure]} its newest history ` +
          "entry recorded; it was raised by hand. Restore it from git, and record growth with --reason");
    }
  }
  return problems;
}
