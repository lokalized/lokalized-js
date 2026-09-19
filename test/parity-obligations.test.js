import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * THE PARITY DECLARATION, CHECKED AGAINST THE PLAN RATHER THAN AGAINST ITS OWN GENERATOR.
 *
 * `tools/parity-report.mjs` produces the report AND checks it, which makes it the only thing
 * standing between a drifted obligation list and a green run — the shape this project has closed
 * repeatedly by giving a claim a second, independent reader. This file reads the SPEC repo's
 * derived obligations and the RECORDED report, and compares them without running the generator.
 *
 * **IT ALSO CHECKS THE STATEMENT HASHES, which is the part a re-run of the generator cannot.** The
 * obligations carry a SHA-256 over plan 8.5's exact bytes; if a bullet is reworded, the generator
 * rewrites the report against the new wording and both agree, happily, about something the plan no
 * longer says. Pinning the hashes here means the reword has to be noticed by a person.
 */

const root = new URL("../", import.meta.url).pathname;
const report = JSON.parse(readFileSync(`${root}measurements/lokalized-parity.json`, "utf8"));
const derived = JSON.parse(readFileSync(`${root}../lokalized-spec/parity-obligations.json`, "utf8")).obligations;

test("the derivation is not vacuous", () => {
  // Without this, a spec artifact that failed to extract anything would make every comparison
  // below trivially true — which is the state the gate it replaced had, because there was no gate.
  assert.ok(derived.length >= 12, `plan 8.5 yields ${derived.length} obligation(s); it had 12`);
  assert.ok(derived.some((o) => o.kind === "content"), "no content bullet was extracted");
  assert.ok(derived.some((o) => o.kind !== "content"), "no prose requirement was extracted");
});

test("every obligation plan 8.5 states is discharged by something named", () => {
  assert.equal(report.obligations.length, derived.length,
    "the report accounts for a different number of obligations than the plan states");
  for (const obligation of derived) {
    const claimed = report.obligations.find((o) => o.index === obligation.index);
    assert.ok(claimed, `the report does not mention obligation ${obligation.index}: ${obligation.sentence}`);
    assert.ok(claimed.dischargedBy.length > 0 && !claimed.dischargedBy.includes("NOTHING"),
      `obligation ${obligation.index} is discharged by nothing: ${obligation.sentence}`);
  }
});

test("the report was generated against the plan's current wording", () => {
  // The hash is over 8.5's exact UTF-8 bytes. A reworded bullet moves it, and the report then cites
  // a statement that no longer exists — which is invisible if you only compare field names.
  for (const obligation of derived) {
    const claimed = report.obligations.find((o) => o.index === obligation.index);
    assert.equal(claimed.statementSha256, obligation.statementSha256,
      `obligation ${obligation.index} was reworded in the plan since the report was recorded: ` +
      `${obligation.sentence}`);
  }
});

test("no field is null without a reason or a blocker", () => {
  // The whole premise of the document: a reader must be able to tell an absent field from an
  // absent problem. An unexplained null blurs exactly that.
  const nulls = Object.entries(report.fields).filter(([, value]) => value === null).map(([name]) => name);
  const explained = new Set(report.undetermined.map((u) => u.field));
  assert.deepEqual(nulls.filter((name) => !explained.has(name)), [],
    "a field is null and appears in neither the reason nor the blocker list");
  for (const entry of report.undetermined)
    assert.ok(entry.reason || entry.blocker, `${entry.field} is undetermined and says nothing about why`);
});

test("the strict required partition is met, and says so from its own arithmetic", () => {
  // Plan 8.5 makes this a release gate: "The strict required partition must show zero failed,
  // xfailed, and unsupported IDs." Asserted against the report's own numbers rather than against
  // its boolean, so a `met: true` beside a non-zero bucket fails here.
  const s = report.strictPartition;
  assert.equal(s.met, true, `the strict required partition is not met: ${JSON.stringify(s)}`);
  assert.equal(s.passingCount, s.requiredCount, "not every required case is passing");
  for (const bucket of ["failed", "xfailed", "notImplemented", "refusedByDesign", "noCounterpart"])
    assert.equal(s[bucket], 0, `${s[bucket]} required case(s) are in the '${bucket}' bucket`);
  assert.ok(s.requiredCount >= 2137, `the required partition holds ${s.requiredCount}; it held 2,137`);
});

test("an empty ID set is distinguishable from a set holding one empty string", () => {
  // The first digest form hashed both to e3b0c442…, and THREE of the six sets are empty — so for
  // exactly the sets whose emptiness is the claim, the digest asserted nothing.
  const empty = Object.values(report.fields).filter((v) => v && typeof v === "object" && v.count === 0);
  assert.ok(empty.length >= 3, `only ${empty.length} empty id set(s); this report had 3`);
  for (const set of empty)
    assert.notEqual(set.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "an empty id set hashes to the digest of the empty STRING, which `[\"\"]` also hashes to");
});

test("the ID sets are carried verbatim, not only as a digest", () => {
  // A digest-only report is unfalsifiable by its own audience: the corpus is not in the tarball, so
  // a consumer cannot re-derive the ids the digest covers.
  const required = report.fields.requiredPortableIds;
  assert.ok(Array.isArray(required.ids), "requiredPortableIds carries no verbatim id list");
  assert.equal(required.ids.length, required.count, "the verbatim list and the count disagree");
  assert.deepEqual([...required.ids].sort(), required.ids, "the ids are not in canonical sorted order");
});
