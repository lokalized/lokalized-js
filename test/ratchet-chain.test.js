// @ts-check
/**
 * `tools/ratchet-chain.mjs` is what stops a ratchet being reset by deleting its record. Each way of
 * tampering with a history must be named, and an intact one must pass, or the ratchets that rely on
 * it are only as strong as the file nobody re-reads.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chainProblems, chained, checkpointOf, entryDigest, figureProblems } from "../tools/ratchet-chain.mjs";

/** @param {number} n */
function history(n) {
  /** @type {object[]} */
  const out = [];
  for (let i = 0; i < n; i++) out.push(chained(out, { reason: `entry ${i}`, figure: 100 + i }));
  return out;
}
const three = history(3);
const origin = entryDigest(three[0]);

test("an intact history passes, and the digest ignores the order keys were written in", () => {
  assert.deepEqual(chainProblems(three, origin, "r"), []);
  assert.equal(entryDigest({ a: 1, b: { c: 2, d: 3 } }), entryDigest({ b: { d: 3, c: 2 }, a: 1 }));
});

test("a missing or empty history is refused, never read as agreement", () => {
  assert.match(chainProblems(undefined, origin, "r").join(), /carries no history/);
  assert.match(chainProblems([], origin, "r").join(), /carries no history/);
});

test("a history with no frozen origin names the digest to freeze", () => {
  assert.match(chainProblems(three, undefined, "r").join(), new RegExp(`freeze "${origin}"`));
});

test("deleting, reordering or editing any entry but the newest breaks the chain", () => {
  assert.match(chainProblems([three[0], three[2]], origin, "r").join(), /entry 1 does not follow entry 0/);
  assert.match(chainProblems([three[0], three[2], three[1]], origin, "r").join(), /does not follow/);
  const edited = [three[0], { ...three[1], reason: "rewritten" }, three[2]];
  assert.match(chainProblems(edited, origin, "r").join(), /entry 2 does not follow entry 1/);
});

test("a history started over, or with its first entry removed or edited, does not start at the frozen origin", () => {
  assert.match(chainProblems(history(1), entryDigest({ other: true }), "r").join(), /does not start at the entry frozen/);
  assert.match(chainProblems(three.slice(1), origin, "r").join(), /does not start at the entry frozen/);
  assert.match(chainProblems([{ ...three[0], figure: 1 }, ...three.slice(1)], origin, "r").join(), /does not start at the entry frozen/);
});

// THE LIMIT, PINNED SO THE HEADER STAYS TRUE OF THE CODE. Nothing names the newest entry, so the
// chain alone passes every one of these. If this test ever fails because the chain learned to see its
// own end, the header's paragraph about it must change with it.
test("the chain alone cannot see its own end: a cut or edited tail passes without a checkpoint", () => {
  assert.deepEqual(chainProblems(three.slice(0, 2), origin, "r"), [], "the last entry dropped");
  assert.deepEqual(chainProblems(three.slice(0, 1), origin, "r"), [], "cut back to the first entry");
  assert.deepEqual(chainProblems([three[0], three[1], { ...three[2], reason: "rewritten" }], origin, "r"), [], "the last entry edited");
});

test("a frozen checkpoint pins every entry up to it, and names a cut, edited or replaced tail", () => {
  const five = history(5);
  const five0 = entryDigest(five[0]);
  const at3 = { index: 3, sha256: entryDigest(five[3]) };
  assert.deepEqual(checkpointOf(five.slice(0, 4)), at3);
  assert.deepEqual(chainProblems(five, five0, "r", at3), [], "entries after the checkpoint are allowed");
  assert.deepEqual(chainProblems(five.slice(0, 4), five0, "r", at3), [], "the checkpoint may be the newest entry");

  assert.match(chainProblems(five.slice(0, 3), five0, "r", at3).join(), /ends at entry 2, and its tool freezes it through entry 3: entries were cut from its end/);
  assert.match(chainProblems(five.slice(0, 1), five0, "r", at3).join(), /ends at entry 0/);
  const lastEdited = [...five.slice(0, 3), { ...five[3], reason: "rewritten" }];
  assert.match(chainProblems(lastEdited, five0, "r", at3).join(), /history entry 3 is not the entry its tool freezes/);
  // An earlier entry edited AND every later link recomputed is a valid chain from the origin's side;
  // the checkpoint's digest covers the links, so it still names the rewrite.
  /** @type {object[]} */
  const relinked = [];
  for (const [i, entry] of five.entries()) {
    const { previousSha256: _, ...content } = /** @type {any} */ (entry);
    relinked.push(chained(relinked, i === 2 ? { ...content, reason: "rewritten" } : content));
  }
  const problems = chainProblems(relinked, five0, "r", at3);
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems.join(), /history entry 3 is not the entry its tool freezes/);
});

test("a hand-edited non-object entry is reported rather than crashed on", () => {
  assert.match(chainProblems([three[0], null], origin, "r").join(), /not an object/);
});

test("figures at or below what the newest entry recorded pass; above, missing, extra or not a count fail", () => {
  const recorded = { a: { modules: 3, bytes: 300 }, b: { modules: 2, bytes: 200 } };
  assert.deepEqual(figureProblems({ a: { modules: 3, bytes: 300 }, b: { modules: 2, bytes: 200 } }, recorded, "r"), []);
  assert.deepEqual(figureProblems({ a: { modules: 3, bytes: 290 }, b: { modules: 1, bytes: 200 } }, recorded, "r"), [], "a shrink");

  assert.match(figureProblems({ a: { modules: 3, bytes: 301 }, b: recorded.b }, recorded, "r").join(),
    /a bytes is 301, above the 300 its newest history entry recorded/);
  assert.match(figureProblems({ b: recorded.b }, recorded, "r").join(), /holds no a row, which its newest history entry recorded/);
  assert.match(figureProblems({ ...recorded, c: { modules: 1, bytes: 1 } }, recorded, "r").join(), /holds a c row its newest history entry did not record/);
  assert.match(figureProblems({ a: { modules: 3 }, b: recorded.b }, recorded, "r").join(), /a bytes is undefined, not a count/);
  assert.match(figureProblems({ a: { modules: 3, bytes: "300" }, b: recorded.b }, recorded, "r").join(), /a bytes is "300", not a count/);
  assert.match(figureProblems({ a: { modules: 3, bytes: -1 }, b: recorded.b }, recorded, "r").join(), /not a count/);
  assert.match(figureProblems(recorded, { ...recorded, a: { modules: 3, bytes: "x" } }, "r").join(), /recorded "x" for a bytes, which is not a count/);
  assert.match(figureProblems(recorded, undefined, "r").join(), /records no figures/);
  assert.match(figureProblems(recorded, [], "r").join(), /records no figures/);
});
