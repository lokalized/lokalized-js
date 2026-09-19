import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { defineLocalizedString } from "../src/parse/index.js";
import { DEFINE_REFUSAL_ADAPTATIONS } from "../tools/define-refusals.mjs";

/**
 * The programmatic door's refusals, and the table that adapts Java's wording to this library's.
 *
 * The corpus family `owed-define` builds a `LocalizedString` from each case input and asks a
 * constructed `Strings` whether its catalog holds an equal value. Twenty of its twenty-two rows
 * observe that equality; the other two observe a graph Java's value-object constructors REFUSE, and
 * the conformance runner compares the refusal identity after mapping Java's recorded pair through
 * `tools/define-refusals.mjs`.
 *
 * That mapping is only worth anything while both ends hold. The runner keys it on the JAVA side
 * exactly and fails on a stale entry; THIS FILE holds the JS side, by driving `defineLocalizedString`
 * with the same degenerate graph and asserting the port raises the entry's `jsType`/`jsMessage`
 * verbatim. Without it the table could be edited to match a port whose wording had silently drifted,
 * and the conformance family would stay green while the diagnostics moved.
 *
 * `SUBJECTS` is keyed by the `LocalizedString.java` site the table names, and every entry must appear
 * here — asserted below, so an entry added without an input that reaches it fails rather than sitting
 * unexercised.
 */

/** The input each refusal differs from in exactly one member, so the refusal is attributable. */
const CONTROL = Object.freeze({
  key: "Fragment",
  translation: "{{f}}",
  placeholders: {
    f: {
      kind: "expression",
      translation: "few",
      alternatives: [{ expression: "count > 5", translation: "many" }],
    },
  },
});

/** @type {Record<string, () => unknown>} keyed by the `LocalizedString.java` site the table names */
const SUBJECTS = {
  // :872 -- a template placeholder whose alternatives list is PRESENT and EMPTY. Presence is the
  // whole input: omitting the member builds a perfectly good translation-only fragment, which is
  // exactly what Java's own advice tells the caller to do instead.
  "LocalizedString.java:872": () =>
    defineLocalizedString({
      ...CONTROL,
      placeholders: { f: { kind: "expression", translation: "few", alternatives: [] } },
    }),
  // :111 -- a root node carrying a key and nothing that could render.
  "LocalizedString.java:111": () => defineLocalizedString({ key: "Plain" }),
};

/** The `(javaType, javaMessage)` pair as one comparable string. */
const javaPair = (type, message) => JSON.stringify([type, message]);

test("every declared define-refusal adaptation is driven by an input here", () => {
  // The staleness rule from the JS side. The runner enforces the other direction — an entry no
  // corpus case consults reddens the run — and between them a declaration cannot survive without
  // both a Java recording and a JS input that reaches it.
  assert.ok(DEFINE_REFUSAL_ADAPTATIONS.length > 0, "the adaptation table is empty");
  for (const entry of DEFINE_REFUSAL_ADAPTATIONS)
    assert.ok(SUBJECTS[entry.site], `no subject drives ${entry.site}`);
  for (const site of Object.keys(SUBJECTS))
    assert.ok(
      DEFINE_REFUSAL_ADAPTATIONS.some((entry) => entry.site === site),
      `${site} has a subject and no table entry`,
    );
});

test("the port raises each adaptation's declared JS refusal, verbatim", () => {
  for (const entry of DEFINE_REFUSAL_ADAPTATIONS)
    assert.throws(
      SUBJECTS[entry.site],
      { name: entry.jsType, message: entry.jsMessage },
      `${entry.site} no longer raises what tools/define-refusals.mjs declares`,
    );
});

test("the control builds, so each refusal is attributable to the one member that differs", () => {
  // Without this the file would pass over a `defineLocalizedString` that refused everything, and the
  // two assertions above would be measuring nothing but the message of a blanket rejection.
  const defined = defineLocalizedString(CONTROL);

  assert.equal(defined.key, "Fragment");
  assert.equal(defined.placeholders.f.alternatives.length, 1);

  // The non-empty half of :872's rule, and the remedy its message names: a fragment with NO
  // alternatives member at all is legal.
  assert.equal(
    defineLocalizedString({
      ...CONTROL,
      placeholders: { f: { kind: "expression", translation: "few" } },
    }).placeholders.f.translation,
    "few",
  );
  // The non-degenerate half of :111's rule, twice: a translation alone, and an alternative alone.
  assert.equal(defineLocalizedString({ key: "Plain", translation: "Hello" }).translation, "Hello");
  assert.equal(
    defineLocalizedString({
      key: "Alts",
      alternatives: [{ expression: "count > 1", translation: "plural" }],
    }).alternatives.length,
    1,
  );
});

let corpus = null;
try {
  corpus = JSON.parse(
    readFileSync(new URL("../../lokalized-spec/generated/behavioral-vectors.json", import.meta.url), "utf8"),
  );
} catch {
  // Sibling spec checkout not present.
}
const corpusSkip = corpus
  ? false
  : "behavioral vectors not found at ../lokalized-spec/generated/behavioral-vectors.json";

test("every adaptation's JAVA pair is one the corpus actually records", { skip: corpusSkip }, () => {
  // The table is keyed on the Java side, so an entry naming a pair no case records would never be
  // consulted — the runner would call it stale. This asserts the same thing one step earlier, and
  // for a reason the runner cannot: it is the only place a reader can see that the `javaMessage`
  // strings were copied from the recording rather than typed from memory, which is how the
  // wrong-message class of defect starts in this project.
  const recorded = corpus.cases
    .filter((testCase) => testCase.operation === "define" && testCase.expected.define.built === false)
    .map((testCase) => javaPair(testCase.expected.define.failureType, testCase.expected.define.failureMessage));

  assert.ok(recorded.length > 0, "the corpus records no define refusal at all");
  for (const entry of DEFINE_REFUSAL_ADAPTATIONS)
    assert.ok(
      recorded.includes(javaPair(entry.javaType, entry.javaMessage)),
      `${entry.site}: no define case records ${entry.javaType}: ${JSON.stringify(entry.javaMessage)}`,
    );
  assert.equal(
    new Set(recorded).size,
    DEFINE_REFUSAL_ADAPTATIONS.length,
    "the corpus records a define refusal the table does not adapt",
  );
});
