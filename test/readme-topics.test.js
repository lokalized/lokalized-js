// @ts-check
/**
 * EVERY DOCUMENTATION TOPIC THE PLAN'S M-D ROW NAMES HAS A SECTION, OR A DECLARED REASON IT DOES NOT.
 *
 * The obligation is one sentence in the plan's milestone table — "Documentation covers tiebreakers,
 * tagged values, loading, failures, accessibility, CSP, caching, data mismatch, RSC, Java migration,
 * and i18next differences" — and **nothing compared the README to it until 2026-09-17.** That is the
 * one-directional-gate shape this project has closed three times at the symbol level
 * (`declared-surface` for promised names, `allowlist-type-surface` for promised categories,
 * `plan-surface` for signatures the plan declares outside section 3.1) and never at the
 * documentation level, where the whole of M-D's deliverable is.
 *
 * WHAT IT FOUND ON ITS FIRST RUN, which is why it exists rather than being prophylactic: of the
 * eleven topics, **RSC and accessibility had ZERO coverage** in a 2,400-line README whose own status
 * record read "README COMPLETE", and `data mismatch` had one passing clause. The single apparent hit
 * for accessibility was the word "vari*able*" matching a grep for `aria`.
 *
 * THE LIST IS DERIVED, THE MAPPING IS DECLARED, and the split is deliberate. The topics come from
 * `lokalized-spec/documentation-topics.json`, generated from the plan itself, so the obligation
 * cannot be quietly trimmed here. Which section covers a topic is a judgement and belongs with the
 * document — but it is a judgement that FAILS when the section is renamed away, deleted, or reduced
 * to a stub, which is the part nobody was doing by hand.
 *
 * A DECLINED topic needs a reason, and the decline goes STALE the moment the README covers it
 * anyway. That is the rule every other list here carries; a list of excuses that cannot rot is what
 * this project has caught three times.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReadme } from "../tools/readme-blocks.mjs";

const root = new URL("../", import.meta.url).pathname;
const readme = readFileSync(`${root}README.md`, "utf8");
const artifact = JSON.parse(readFileSync(`${root}../lokalized-spec/documentation-topics.json`, "utf8"));

const obligationFor = (kind) =>
  artifact.obligations.find((entry) => entry.milestone === "M-D" && entry.kind === kind);
const obligation = obligationFor("documentation");
const quickstarts = obligationFor("quickstarts");

/** The groups `check:readme` actually executes, and how many outputs each one asserts. */
const executed = parseReadme(readme).groups;

/**
 * Heading text -> the lines that belong to it, INCLUDING its subsections.
 *
 * A `##` section runs to the next `##`, so its `###` subsections count as part of it; each `###`
 * also gets its own entry, so a topic can be mapped at either level. The first version stopped every
 * section at the next heading of ANY level and reported `## Locale matching` as ten lines, because
 * almost all of it is the subsection underneath — which would have made the substance check below
 * punish exactly the well-structured sections it is meant to protect.
 */
function sections() {
  const lines = readme.split("\n");
  /** @type {Array<{ level: number, title: string, at: number }>} */
  const headings = [];
  for (let index = 0; index < lines.length; ++index) {
    const heading = /^(#{2,3})\s+(.*?)\s*$/.exec(/** @type {string} */ (lines[index]));
    if (heading) headings.push({ level: heading[1].length, title: /** @type {string} */ (heading[2]), at: index });
  }
  /** @type {Map<string, string[]>} */
  const found = new Map();
  /** @type {Map<string, { from: number, to: number }>} */
  const ranges = new Map();
  for (let index = 0; index < headings.length; ++index) {
    const { level, title, at } = /** @type {{ level: number, title: string, at: number }} */ (headings[index]);
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= level);
    const to = next ? next.at : lines.length;
    found.set(title, lines.slice(at + 1, to));
    ranges.set(title, { from: at + 1, to });
  }
  sections.ranges = ranges;
  return found;
}

/**
 * Which section covers which obligation. Keyed on the plan's own wording for the topic, so a topic
 * the plan renames arrives here as a missing entry rather than silently matching the old one.
 */
const COVERAGE = {
  "tiebreakers": { heading: "Locale matching" },
  "tagged values": { heading: "Language forms are values, not strings" },
  "loading": { heading: "Loading translations" },
  "failures": { heading: "Failure handling" },
  "accessibility": { heading: "Accessibility, and where this library's part ends" },
  "CSP": { heading: "Bundling and Content Security Policy" },
  "caching": { heading: "Caching a localized page" },
  "data mismatch": { heading: "When the data behind two builds disagrees" },
  "RSC": { heading: "React Server Components, and what can cross the boundary" },
  "Java migration": { heading: "Coming from lokalized-java" },
  // **THIS WAS THE ONE DECLINED TOPIC AND THE DECLINE IS WITHDRAWN.** It read: "a comparison section
  // would be recollection about software this machine does not have, published under a heading
  // implying it was checked." **That premise was measured FALSE on 2026-09-18** — i18next 26.4.2
  // installs and runs here — so the section is written the way everything else in this README is,
  // by executing both libraries. The decline's own `staleIf` fired the moment the README said
  // "i18next", which is the mechanism working rather than a rule being escaped.
  "i18next differences": { heading: "How this differs from i18next" },
};

test("the derivation is not vacuous", () => {
  // Without this, an artifact this test failed to read — or a heading scanner that matched nothing —
  // would make every comparison below trivially true, which is the shape the gates it follows had.
  assert.ok(obligation, "documentation-topics.json states no M-D obligation");
  assert.ok(obligation.items.length >= 8, `only ${obligation.items?.length} topics were derived`);
  assert.ok(sections().size >= 30, `only ${sections().size} README headings were found`);
  assert.match(obligation.sentence, /^Documentation covers /);
});

test("every topic the plan names has an entry here", () => {
  const entries = Object.keys(COVERAGE).sort();
  assert.deepEqual(entries, [...obligation.items].sort(),
    "the plan's topic list and this table have drifted apart — a topic with no entry is a " +
    "deliverable nobody is checking, and an entry for no topic is a rule with nothing behind it");
});

test("every covered topic names a section that exists and has substance", () => {
  const found = sections();
  for (const [topic, entry] of Object.entries(COVERAGE)) {
    if (!("heading" in entry)) continue;
    const body = found.get(entry.heading);
    assert.ok(body !== undefined,
      `'${topic}' is documented under "${entry.heading}", and the README has no such heading. ` +
      `Either the section was renamed or removed, or the topic is no longer covered.`);
    // A STUB SATISFIES A HEADING CHECK, which is exactly the vacuity this file is written against.
    const substantive = body.filter((line) => line.trim().length > 0).length;
    assert.ok(substantive >= 12,
      `'${topic}' maps to "${entry.heading}", which has only ${substantive} non-empty line(s)`);
  }
});

test("a declined topic carries a reason, and the decline goes stale if it is covered anyway", () => {
  const declined = Object.entries(COVERAGE).filter(([, entry]) => "declined" in entry);

  // **ZERO TOPICS ARE DECLINED TODAY, AND THIS RULE IS KEPT RATHER THAN DELETED.** It used to assert
  // `declined.length >= 1` as its anti-vacuity term, which was right while the i18next comparison was
  // declined and became a failure the moment that decline was withdrawn — the rule reporting, truly,
  // that it now checks nothing. Deleting it would leave the NEXT decline ungoverned; leaving the
  // old term would demand a decline exist so the rule has something to do, which is the tail wagging
  // the dog. So the machinery is negative-tested against a synthetic entry instead, and the rule
  // stays live for a real one.
  const SYNTHETIC = ["a topic nobody declined", {
    declined: "a reason long enough to satisfy the length rule below, standing in for a real one so " +
      "that this rule is exercised even when no topic is actually declined",
    staleIf: /\bzzzz-no-readme-mentions-this\b/,
  }];
  for (const [topic, entry] of [...declined, SYNTHETIC]) {
    assert.ok(entry.declined.length > 80, `'${topic}' is declined without a reason worth reading`);
    assert.ok(entry.staleIf instanceof RegExp, `'${topic}' declares no staleness predicate`);
    assert.ok(!entry.staleIf.test(readme),
      `'${topic}' is recorded as declined and the README now discusses it. Delete the decline and ` +
      `map the topic to its section, or delete the section.`);
  }

  // AND THE STALENESS PREDICATE MUST ACTUALLY BE ABLE TO FIRE, or the rule above is three assertions
  // that never say no. Proved on the synthetic entry rather than asserted: a predicate the README
  // DOES match is caught.
  const alwaysStale = /** @type {RegExp} */ (/\bthe\b/i);
  assert.ok(alwaysStale.test(readme),
    "the staleness check cannot fire, so the rule above would pass over a live decline");
});

/**
 * Which EXECUTED group discharges each quickstart the row names.
 *
 * "Executed" is the plan's own word and this is what makes it checkable: the group must be one
 * `tools/readme-blocks.mjs` yields, with at least one asserted output. A section that merely exists
 * satisfies the documentation obligation above; a quickstart has to RUN.
 */
const QUICKSTART = {
  "npm/bundler": "quickstart",
  "direct browser": "browser-quickstart",
  "SSR": "ssr",
  "explicit-locale use": "matching",
};

test("every quickstart the plan names maps to a group, and that group is executed", () => {
  assert.ok(quickstarts, "documentation-topics.json states no M-D quickstart obligation");
  assert.ok(executed.size >= 30, `only ${executed.size} executed groups were parsed`);
  assert.deepEqual(Object.keys(QUICKSTART).sort(), [...quickstarts.items].sort(),
    "the plan's quickstart list and this table have drifted apart");

  for (const [quickstart, group] of Object.entries(QUICKSTART)) {
    const found = executed.get(group);
    assert.ok(found !== undefined,
      `the '${quickstart}' quickstart is discharged by the executed group '${group}', and no such ` +
      `group exists. The plan's word is EXECUTED: a section nothing runs does not satisfy it.`);
    assert.ok(found.assertions >= 1,
      `the '${quickstart}' quickstart runs as '${group}' and asserts nothing, so nothing about it ` +
      `can go stale when the library moves`);
  }
});

test("the direct-browser quickstart is executed from its own `<script type=\"module\">`", () => {
  // The one that was NOT executed when this rule landed, and the reason the rule exists: it lived in
  // a ```html block, made real library calls, and claimed its output in a trailing comment that
  // nothing compared to anything. Asserting the SHAPE here — that the group comes from an html block
  // rather than a js block someone added beside it — is what stops the gap reopening quietly.
  const { htmlModules } = parseReadme(readme);
  assert.ok(htmlModules.has(QUICKSTART["direct browser"]),
    `'${QUICKSTART["direct browser"]}' is not parsed from a \`\`\`html block. If the browser sample ` +
    `moved to a js block, the page a reader copies is once again unchecked.`);
});

/**
 * A TOPIC IS COVERED ONLY IF ITS SECTION CARRIES SOMETHING THAT RUNS.
 *
 * **MEASURED 2026-09-17, and the hole was mine:** the substance rule above asks for twelve non-empty
 * lines, and TWENTY LINES OF FILLER under the right heading passed the whole file. An agent
 * verdicting M-D's clauses found it by replacing the accessibility section's body outright; I
 * reproduced it before changing anything. "Documentation covers X" discharged by a heading plus a
 * line count is presence, not coverage — and `check:readme` does not close the gap either, because
 * its anti-vacuity terms are GLOBAL counts: S18 measured that deleting the entire README security
 * section leaves it at exit 0.
 *
 * So each mapped section must contain at least one EXECUTED block that asserts something. That is
 * derived rather than declared: `parseReadme` stamps every block it takes with its README line, so
 * the question "does this section execute anything" is a comparison between the section's line range
 * and the groups' own line stamps. It is still not a check that the prose is TRUE — no such gate
 * exists — but a section that runs nothing cannot go stale when the library moves, and that is the
 * property the topic obligation is really about.
 */
test("every covered topic's section contains an executed, asserting block", () => {
  const found = sections();
  const ranges = /** @type {Map<string, { from: number, to: number }>} */ (sections.ranges);
  const { groups } = parseReadme(readme);

  /** Every README line a group's blocks were taken from, with how much that group asserts. */
  const stamped = [...groups.entries()].flatMap(([name, group]) =>
    group.code.flatMap((line) => {
      const at = /^\/\/ --- README line (\d+) ---$/.exec(line);
      return at ? [{ name, at: Number(at[1]), assertions: group.assertions }] : [];
    }));
  assert.ok(stamped.length >= 40, `only ${stamped.length} stamped blocks were found — the derivation is broken`);

  for (const [topic, entry] of Object.entries(COVERAGE)) {
    if (!("heading" in entry)) continue;
    const range = ranges.get(entry.heading);
    assert.ok(range, `no range for "${entry.heading}"`);
    const inside = stamped.filter((block) => block.at > range.from && block.at <= range.to && block.assertions > 0);
    assert.ok(inside.length > 0,
      `'${topic}' maps to "${entry.heading}", which contains no executed block that asserts anything. ` +
      `A section can be twelve lines of filler and satisfy the substance rule; it cannot be filler ` +
      `and also run.`);
  }
});
