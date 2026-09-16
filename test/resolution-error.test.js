// @ts-check
/**
 * JAVA'S FOUR ARMS AT THE PLACEHOLDER BOUNDARY — plan 3.5's `ResolutionError`, and the arm that
 * justifies it.
 *
 * The port had arm 1 (an expression failure keeps its class) and a catch-all. The two middle arms —
 * Java's recognized invalid VALUE and invalid STATE — were bare `Error`s, which made them
 * indistinguishable from arm 4: an unrecognized APPLICATION exception, which Java returns VERBATIM.
 * So the port contextualized what Java hands back unchanged. **Measured on the pinned JDK before
 * this landed: an application exception comes out of `getResult().getCause()` with its class and
 * message intact and a chain of LENGTH 1, while the port wrapped it once at the language-form
 * boundary and twice at the fragment boundary.** Plan 2.5:249 requires the unchanged store.
 *
 * **THE CORPUS CANNOT ARBITRATE ANY OF THIS, which is why this file exists.** Censused across all
 * 2,363 cases, the only application-thrown class anywhere is `java.lang.IllegalStateException` — a
 * class Java RECOGNIZES and contextualizes at arm 3. **No case takes arm 4.** And the two codes are
 * invisible to it as well: measured, collapsing every `RESOLUTION_INVALID_STATE` into
 * `RESOLUTION_INVALID_ARGUMENT` at every raiser leaves the conformance report BYTE-IDENTICAL,
 * because `causeNameOf` reads `.name` and plan 3.5 gives ONE class for both codes. Every proposition
 * below is unit-test-only, and saying so is the point.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { RETURN_KEY, ResolutionError, THROW_EXCEPTION, createStrings } from "../src/core/index.js";

/** A catalog whose one key renders through a language-form placeholder, so the resolver is reached. */
const PHONETIC = {
  en: { Key: { translation: "{{a}} thing",
    placeholders: { a: { value: "term", translations: { PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a" } } } } },
};

const instance = (/** @type {() => unknown} */ resolver, onFailure = () => THROW_EXCEPTION) =>
  createStrings({ strings: PHONETIC, fallbackLocale: "en", locale: "en",
    phoneticResolver: /** @type {any} */ (resolver), onFailure: /** @type {any} */ (onFailure) });

const caught = (/** @type {() => unknown} */ body) => {
  try { body(); return null; } catch (error) { return /** @type {any} */ (error); }
};

test("arm 4: an unrecognized application error is returned UNCHANGED, with nothing added", () => {
  // THE PROPOSITION THE WHOLE CHANGE IS FOR. A plain `Error` from an application callback is not a
  // class the ladder recognizes, so Java returns it and so must the port.
  class AppBoom extends Error {}
  const boom = new AppBoom("sentinel");
  const error = caught(() => instance(() => { throw boom; }).get("Key", { term: "apple" }));

  assert.equal(error, boom, "the application's own object, by identity");
  assert.ok(error instanceof AppBoom, "and its own class, which a wrapper would have lost");
  assert.equal(error.message, "sentinel", "and its own message, uncontextualized");
  assert.equal(error.cause, undefined, "chain of length 1, as Java produces");
  assert.ok(!(error instanceof ResolutionError), "arm 4 is NOT a library error");
});

test("arms 2 and 3: a recognized value or state failure becomes a ResolutionError with its code", () => {
  // TypeError and RangeError are the JS spellings plan 2.5:253-254 makes recognized. Both arms are
  // asserted in one test so the pair is what discriminates: an implementation that mapped everything
  // to one code passes either arm alone.
  for (const [thrown, code] of /** @type {[Error, string][]} */ ([
    [new RangeError("out of range"), "RESOLUTION_INVALID_ARGUMENT"],
    [new TypeError("wrong type"), "RESOLUTION_INVALID_ARGUMENT"],
  ])) {
    const error = caught(() => instance(() => { throw thrown; }).get("Key", { term: "apple" }));
    assert.ok(error instanceof ResolutionError, `${thrown.name} must be recognized, not returned raw`);
    assert.equal(error.code, code);
    assert.equal(error.cause, thrown, "the original is retained by reference, never copied");
    assert.match(error.message, /^Unable to resolve generated placeholder 'a'/,
      "and a recognized failure IS contextualized, which is what separates arms 2-3 from arm 4");
  }
});

test("a library failure carries its own code up through the ladder rather than being re-derived", () => {
  // The port's own no-resolver guard raises RESOLUTION_INVALID_STATE. Wrapped at the boundary it must
  // STILL be invalid-state: the code travels with the cause, because a library failure already knows
  // the category Java would have re-derived, and re-deriving could only disagree.
  const error = caught(() =>
    createStrings({ strings: PHONETIC, fallbackLocale: "en", locale: "en",
      onFailure: () => THROW_EXCEPTION }).get("Key", { term: "apple" }));
  assert.ok(error instanceof ResolutionError);
  assert.equal(error.code, "RESOLUTION_INVALID_STATE");
  assert.ok(error.cause instanceof ResolutionError, "the leaf survives underneath the wrapper");
  assert.equal(error.cause.code, "RESOLUTION_INVALID_STATE", "and the wrapper took ITS code");
});

test("a nullish throw is normalized, and `thrownValue` is present ONLY there", () => {
  // THE ONE RAISER WITH NO JAVA COUNTERPART. Plan 2.5:254-256 says Java cannot throw null; plan
  // 3.5:1136-1140 specifies the JS case anyway. Before this, `throw null` reached
  // `TranslationFailure.cause === null` and core then raised a MissingTranslationError — a wrong
  // answer, not a missing field.
  for (const [thrown, spelled] of /** @type {[unknown, string][]} */ ([[null, "null"], [undefined, "undefined"]])) {
    const error = caught(() => instance(() => { throw thrown; }).get("Key", { term: "apple" }));
    assert.ok(error instanceof ResolutionError, `throw ${spelled} must not escape as a bare value`);
    assert.equal(error.code, "RESOLUTION_INVALID_STATE", "plan 3.5:1140 fixes the code for this leaf");
    assert.equal(error.thrownValue, spelled);
    assert.equal(error.cause, undefined, "it carries no cause, because there is nothing to carry");
  }

  // THE OTHER HALF, and the reason `"thrownValue" in error` is usable at all: every other
  // ResolutionError must OMIT the key, not carry it valued `undefined`.
  const ordinary = caught(() => instance(() => { throw new RangeError("x"); }).get("Key", { term: "apple" }));
  assert.ok(ordinary instanceof ResolutionError);
  assert.ok(!("thrownValue" in ordinary), "plan 3.5:1139 — every other ResolutionError omits it");
});

test("the failure handler sees the same object, and RETURN_KEY still recovers", () => {
  // THE CONTROL SET. Without these, every assertion above is satisfied by a port that throws on
  // everything: the ladder must leave the ordinary recovery path working.
  /** @type {any} */
  let handed = null;
  const boom = new Error("app");
  const value = instance(() => { throw boom; }, (/** @type {any} */ f) => { handed = f.cause; return RETURN_KEY; })
    .get("Key", { term: "apple" });
  assert.equal(value, "Key", "RETURN_KEY still returns the key rather than throwing");
  assert.equal(handed, boom, "and the handler was handed the application's object, unchanged");
});
