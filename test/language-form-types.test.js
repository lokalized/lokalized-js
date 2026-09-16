// @ts-check
/**
 * THE 61 CONSTANTS' TYPES, RE-DERIVED FROM THE GENERATED TABLE ON EVERY RUN.
 *
 * The constants have shipped since M5b. **Their TYPES had not, and the gap was not cosmetic.**
 * `src/index.js` built them by looping over `LANGUAGE_FORM_NAMES` into a
 * `Record<string, Readonly<{ axis: string, name: string, … }>>`, so `tsc` emitted every one of the
 * 61 as `Readonly<{…}> | undefined` with both tag fields widened to `string`. Measured against a
 * consumer before the fix: `const axis: "gender" = GENDER_FEMININE.axis` fails with TS2322, and the
 * `| undefined` forced a non-null assertion on a frozen compile-time constant. **A tagged union
 * whose tag is `string` is not a tagged union** — which is exactly why plan 3.7 declares
 * `TaggedLanguageFormValue<"gender", "GENDER_FEMININE">` and not one shared shape.
 *
 * The eleven `*FormName` unions and the 61-property map were GENERATED from `LANGUAGE_FORM_NAMES`,
 * and generated source rots the moment the thing it was generated from moves. So this re-derives the
 * expectation from that table and compares it against the EMITTED `types/*.d.ts` — the artifact a
 * consumer actually reads, not the JSDoc it came from. A member added to the table and not to the
 * unions is a red test rather than a constant the port exports untyped.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LANGUAGE_FORM_NAMES } from "../src/internal/catalog.js";

const root = new URL("../", import.meta.url);
const declarations = (path) => readFileSync(new URL(path, root), "utf8");

/** The authoritative tuples, flattened: the same walk `src/index.js` performs at runtime. */
const FORMS = LANGUAGE_FORM_NAMES.flatMap(([axis, prefix, members]) =>
  members.map((member) => ({ axis, name: `${prefix}${member}`, renderName: member })));

test("the table still holds the 61 the plan and the corpus pin", () => {
  // ANTI-VACUITY FIRST: every assertion below is satisfied by an empty table.
  assert.equal(FORMS.length, 61, "plan 3.7's 61 language-form constants");
  assert.equal(new Set(FORMS.map((f) => f.name)).size, 61, "and the names are distinct");
});

test("every constant is emitted with its EXACT axis, name and renderName, and no `| undefined`", () => {
  const emitted = declarations("types/index.d.ts");
  const wrong = [];
  for (const form of FORMS) {
    const at = emitted.indexOf(`export const ${form.name}: `);
    if (at < 0) { wrong.push(`${form.name}: not exported from the root at all`); continue; }
    const block = emitted.slice(at, emitted.indexOf("export const", at + 10));
    // The three tag fields, as LITERALS. `axis: string` is the defect this test exists for.
    for (const [field, value] of [["axis", form.axis], ["name", form.name], ["renderName", form.renderName]])
      if (!block.includes(`${field}: "${value}"`))
        wrong.push(`${form.name}: ${field} is not the literal "${value}" — ` +
          `${block.match(new RegExp(`${field}: [^;]+`))?.[0] ?? "absent"}`);
    // `| undefined` on a frozen compile-time constant makes every consumer non-null-assert it.
    if (/\}>\s*\|\s*undefined/.test(block)) wrong.push(`${form.name}: declared as possibly undefined`);
  }
  assert.deepEqual(wrong, [],
    "these constants are emitted with a widened or optional type; a consumer cannot select on an " +
    "axis it cannot name, which is the whole purpose of plan 3.7's tagged values");
});

test("each *FormName union is exactly its axis's members, re-derived from the table", () => {
  const emitted = declarations("types/core/index.d.ts");
  const ALIAS = {
    gender: "GenderFormName", "grammatical-case": "GrammaticalCaseFormName",
    definiteness: "DefinitenessFormName", classifier: "ClassifierFormName",
    formality: "FormalityFormName", clusivity: "ClusivityFormName", animacy: "AnimacyFormName",
    cardinality: "CardinalityFormName", ordinality: "OrdinalityFormName", phonetic: "PhoneticFormName",
  };
  const byAxis = new Map();
  for (const form of FORMS) {
    if (!byAxis.has(form.axis)) byAxis.set(form.axis, []);
    byAxis.get(form.axis).push(form.name);
  }
  // The alias table is itself derived-checked: an axis the generated table gains and this map does
  // not is a missing union, not a silently skipped one.
  assert.deepEqual([...byAxis.keys()].sort(), Object.keys(ALIAS).sort(),
    "LANGUAGE_FORM_NAMES and this test's alias map disagree about which axes exist");

  const drifted = [];
  for (const [axis, names] of byAxis) {
    const alias = ALIAS[axis];
    const at = emitted.indexOf(`export type ${alias} = `);
    if (at < 0) { drifted.push(`${alias}: not exported from lokalized/core`); continue; }
    const declared = emitted.slice(at, emitted.indexOf(";", at));
    const members = [...declared.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(members, [...names].sort(), `${alias} is not exactly its axis's members`);
  }
  assert.deepEqual(drifted, []);

  // And the umbrella union must name every alias, or an axis can be delivered and unreachable.
  const umbrella = emitted.slice(emitted.indexOf("export type LanguageFormName = "));
  for (const alias of Object.values(ALIAS))
    assert.ok(umbrella.slice(0, umbrella.indexOf(";")).includes(alias),
      `LanguageFormName does not include ${alias}`);
});
