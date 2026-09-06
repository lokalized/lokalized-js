import assert from "node:assert/strict";
import { test } from "node:test";

import { createStrings } from "../src/core/index.js";

/**
 * `DefaultStrings:690`'s null placeholder-name refusal, held by a default-gate test.
 *
 * The corpus family `owed-null-placeholder-name` measures this against Java, but the conformance
 * runner is NOT the only gate this refusal needs and until 2026-09-06 it was the only one it had:
 * `grep -rn "Placeholder names must not be null" test/` was empty, and `test/construct-refusals.js`
 * covers construction-time refusals only. A defect that only one gate can see is one revert away
 * from being invisible, which is the shape this project has been bitten by repeatedly.
 *
 * The MAP form is load-bearing and not a stylistic choice. Plan 3.2 types `Placeholders` as a record
 * OR a `ReadonlyMap`; only the Map half can carry a null name, because a record key spelled `null`
 * is the four-character STRING "null" and reaches nothing. The record row below is therefore a
 * control in the strict sense — it must NOT throw, and it must resolve normally — so a port that
 * "fixed" this by rejecting the string "null" would fail here rather than pass.
 */
const STRINGS = {
  en: { Greeting: { translation: "Hello, {{who}}" } },
};

const strings = () => createStrings({ fallbackLocale: "en", locale: "en", strings: STRINGS });

test("a null placeholder name in the Map form is refused", () => {
  const s = strings();
  assert.throws(
    () =>
      s.getResult(
        "Greeting",
        new Map([
          ["who", "world"],
          [null, "x"],
        ]),
      ),
    TypeError,
  );
  assert.throws(
    () => s.get("Greeting", new Map([[null, "x"]])),
    /Placeholder names must not be null/,
  );
});

test("CONTROL: the same Map without the null entry resolves", () => {
  const s = strings();
  assert.equal(s.get("Greeting", new Map([["who", "world"]])), "Hello, world");
});

test("CONTROL: a record cannot express the refusal — the key is the string \"null\"", () => {
  const s = strings();
  // `{ [null]: "x" }` is `{ "null": "x" }`. It is an ordinary unused placeholder, not a null name,
  // so this must resolve exactly as the plain record does.
  assert.equal(s.get("Greeting", { who: "world", [null]: "x" }), "Hello, world");
  assert.equal(s.get("Greeting", { who: "world" }), "Hello, world");
});
