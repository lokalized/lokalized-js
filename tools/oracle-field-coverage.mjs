// @ts-check
/**
 * WHICH FIELDS THE JAVA ORACLE EMITS, AND WHICH ONES A DIFFERENTIAL ACTUALLY READS.
 *
 * **THIS DEFECT HAS BEEN FOUND THREE TIMES, IN THREE DIFFERENT TOOLS, ALWAYS THE SAME SHAPE:** the
 * Java side emits a column, the runner never reads it, and the differential is green over a real
 * divergence in exactly the behaviour it was built to guard.
 *
 *   - `diff:lookup` emitted the refusal CLASS and MESSAGE in separate fields and DROPPED THE MESSAGE,
 *     so ablating the port's `Fallback locale` check left it green while the site it was added to
 *     gate went unobserved.
 *   - `diff:language-range` emitted `errorType` on every refusal row since the tool was written and
 *     DROPPED THE CLASS — the exact mirror. Measured 2026-09-14: renaming every `RangeError` the
 *     negotiator throws to `TypeError`, messages byte-identical, left it at 6037/6037, exit 0.
 *   - `diff:direct-tag` computes Java's truncation of an ill-formed tag into `illFormedTruncated`,
 *     PRINTS it beside the port's refusal, and compares it to nothing.
 *
 * Reading a runner and satisfying yourself that it compares enough is how all three survived. So this
 * DERIVES the answer by EXECUTION, the way `tools/conformance.mjs` already does one layer up: the
 * oracle rows are handed to the comparison through a recording proxy, and whatever the comparison
 * touches is what it reads. A field the oracle emits that nothing touches fails the run.
 *
 * **WIRED INTO SIX OF THE NINE, AND THE OTHER THREE ARE A DIFFERENT PROBLEM — not a backlog.**
 * `language-range`, `direct-tag`, `tokenizer`, `likely-subtag`, `interpolate` and `load` hand the
 * Java side JSON OBJECTS, one per line, so "which field" is a question with an answer. `parse`,
 * `phonetic` and `lookup` use POSITIONAL TSV — `parse` splits a line into a name and a joined
 * payload, `lookup` discriminates on `fields[0]` and indexes by position — and a positional row has
 * no named fields to observe. **The premise of this gate does not apply there**, and wiring it would
 * produce a green check over nothing, which is the failure this file exists to prevent. Those three
 * have their own hazard — a COLUMN added on the Java side and never read is invisible, and nothing
 * catches that — and it needs a different instrument: pinning the column COUNT the Java writer emits
 * against the count the runner unpacks. Owed, and named rather than left to be discovered.
 *
 * **WHAT IT CAUGHT, AND WHAT IT CANNOT.** It is proven retrospectively on the real defect: reverting
 * the `errorType` fix makes it name that field and exit 1. It is proven live on a planted one:
 * dropping the `error` column from `diff:tokenizer`'s comparison leaves that tool reporting
 * "373/373 identical" and this gate fails the run. **It cannot see a field read in one BUCKET and
 * not another** — `diff:direct-tag` compared `normalized` on well-formed tags while merely
 * collecting it on ill-formed ones, and because the field is read SOMEWHERE the proxy is satisfied.
 * That gap was fixed by hand; closing it generally means scoping reads to a comparison WINDOW per
 * bucket, the way `conformance.mjs` commits reads only when a case reached a verdict. Also owed.
 *
 * **A DECLARATION IS ALLOWED AND IS CHECKED IN BOTH DIRECTIONS.** Some emitted fields are genuinely
 * not comparable — a bucket selector the runner branches on before the comparison, a value the port
 * has no counterpart for by design. Those are declared with a reason. And a declaration for a field
 * that IS read, or that the oracle no longer emits, fails too: this project has three known-gap
 * lists that rotted before anyone made them fail on stale entries.
 */

/**
 * Wrap oracle rows so every field the comparison touches is observed.
 *
 * @param {readonly Record<string, unknown>[]} rows
 * @returns {{ rows: Record<string, unknown>[], emitted: Set<string>, reads: Set<string> }}
 */
export function recordingOracleRows(rows) {
  const emitted = new Set();
  const reads = new Set();
  // EMITTED IS COMPUTED BEFORE PROXYING, over the union of every row's own keys — not from the first
  // row. An oracle that emits a field only on refusal rows (which is exactly the case for all three
  // defects above) would be invisible to a first-row reading.
  for (const row of rows) for (const key of Object.keys(row)) emitted.add(key);
  const proxied = rows.map((row) => new Proxy(row, {
    get(target, property) {
      if (typeof property === "string" && Object.hasOwn(target, property)) reads.add(property);
      return /** @type {any} */ (target)[property];
    },
    // `JSON.stringify(row)` and `{...row}` read every key through ownKeys+get, which would make the
    // gate vacuous for any runner that serialises a row wholesale. Those reads still go through
    // `get`, so they count — deliberately: a runner that compares the WHOLE row really does read
    // every field, and that is the honest answer rather than a loophole.
  }));
  return { rows: proxied, emitted, reads };
}

/**
 * @param {string} name the differential, for the diagnostic
 * @param {{ emitted: Set<string>, reads: Set<string> }} recorder
 * @param {Record<string, string>} declared field -> why it is emitted and deliberately not compared
 * @returns {string[]} problems; empty when the coverage is complete
 */
export function oracleFieldProblems(name, recorder, declared = {}) {
  const problems = [];
  const unread = [...recorder.emitted].filter((field) => !recorder.reads.has(field)).sort();
  for (const field of unread)
    if (!(field in declared))
      problems.push(`diff:${name}: the oracle emits '${field}' and the comparison never reads it.` +
        ` Compare it, or declare it with the reason it cannot be compared.`);
  for (const field of Object.keys(declared)) {
    if (!recorder.emitted.has(field))
      problems.push(`diff:${name}: '${field}' is declared uncompared and the oracle no longer emits it.`);
    else if (recorder.reads.has(field))
      problems.push(`diff:${name}: '${field}' is declared uncompared and the comparison DOES read it;` +
        ` delete the declaration — the deletion is the record.`);
  }
  // ANTI-VACUITY: a recorder that observed nothing means the rows never reached a comparison at all,
  // which is indistinguishable from complete coverage and is the louder of the two.
  if (recorder.emitted.size > 0 && recorder.reads.size === 0)
    problems.push(`diff:${name}: the oracle emitted ${recorder.emitted.size} field(s) and the` +
      ` comparison read NONE. The rows never reached a comparison, or the recorder was not threaded` +
      ` through the one that runs.`);
  return problems;
}
