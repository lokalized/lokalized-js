// @ts-check
/**
 * `parseLanguageRanges` AGAINST lokalized-spec's EXECUTABLE MODEL, WITH NO JDK — the CI half of the
 * IANA check.
 *
 * Amendment A30 made the pinned IANA registry the SOURCE of the language-range equivalences and the
 * JDK and lokalized-java CHECKS on it. Three statements of how a consumer APPLIES the data exist:
 * lokalized-java's `LocaleMatcher#parseLanguageRanges`, this package's `parseLanguageRanges`, and
 * lokalized-spec's `tools/iana-oracle/model.mjs`. The spec's `npm run check:iana` (pinned JDK) holds
 * the library to the model on every probe and records that it did, naming the probe space by digest
 * in `generated/iana-jdk-check.json`; this file holds THIS parse to the same model on the same space,
 * rebuilt here by the spec's own pure `candidates.mjs`. So CI runs JS == model, and the spec's record
 * says model == Java — neither `diff:language-range` nor `check:iana` runs in CI, because both need
 * the JDK.
 *
 * COMPARED EXACTLY: every range in order, every weight with `Object.is` (so `en;q=-0` keeps its sign
 * on both sides), and on a refusal the MESSAGE, which the model carries verbatim from Java. The
 * model also names Java's exception class; this package raises `RangeError` for both classes the
 * library throws here, which is the name `bestMatchForAcceptLanguage` already gives them, and an
 * unmapped class fails loudly rather than being waved through.
 *
 * WHAT IT FOUND ON ITS FIRST RUN (2026-09-23, A30): a range made only of hyphens (`-`, `---`) was
 * refused here with `range=-` where Java's `String#split` leaves no subtags and `subtags[0]` throws
 * `ArrayIndexOutOfBoundsException` "Index 0 out of bounds for length 0". Two probes of 116,658; no
 * corpus case and no earlier differential probe carried such a range. Fixed in
 * `src/negotiate/index.js` (`checkLanguageRangeGrammar`); `test/negotiate.test.js` pins the row.
 *
 * ABLATIONS, each MEASURED in a throwaway copy with a clean control (0 of 131,461): moving the `-fr`
 * pair to the end of the generated substitutions reds 18 probes; dropping the `mgp` class from the
 * generated full table, 42; deleting the nested region/variant step from `languageRangeExpansions`,
 * 10,983 — the step the single-locale-vs-whole-list grid in `test/locale.test.js` is blind to by
 * construction, because both doors share it (measured: that grid stays green under it); a
 * JDK-21-shaped table at the public parse, 254; reverting the hyphen-only refusal, 2. With
 * `model.mjs` absent the file SKIPS, which CI's no-skip rule and `tools/check-spec-checkout.mjs`
 * (which requires it) both turn red.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { parseLanguageRanges } from "../src/negotiate/index.js";
import {
  IANA_CANDIDATES,
  IANA_EQUIVALENCES_ARTIFACT,
  IANA_JDK_CHECK,
  IANA_MODEL,
  specDirectory,
  specPath,
} from "../tools/iana-artifact.mjs";

const required = [IANA_EQUIVALENCES_ARTIFACT, IANA_JDK_CHECK, IANA_MODEL, IANA_CANDIDATES];
const absent = required.filter((relative) => !existsSync(specPath(relative)));
// Skipped VISIBLY when the sibling spec is absent; CI fails on any skip, so it cannot hide there.
const skip = absent.length === 0 ? false : `lokalized-spec at ${specDirectory()} lacks ${absent.join(", ")}`;

/**
 * The Java exception classes the model reports for a refusal, and the JS class this package raises
 * for each. Both are the parser's own refusals; `bestMatchForAcceptLanguage` catches exactly these.
 */
const JS_CLASS_FOR = new Map([
  ["java.lang.IllegalArgumentException", "RangeError"],
  ["java.lang.ArrayIndexOutOfBoundsException", "RangeError"],
]);

/**
 * @param {(header: string) => readonly { range: string, weight: number }[]} parse
 * @param {string} header
 * @returns {{ ranges: [string, number][] } | { error: string, javaClass: string | undefined, message: string }}
 */
function outcome(parse, header) {
  try {
    return { ranges: parse(header).map(({ range, weight }) => [range, weight]) };
  } catch (error) {
    const thrown = /** @type {Error & { javaClass?: string }} */ (error);
    return { error: thrown.constructor.name, javaClass: thrown.javaClass, message: thrown.message };
  }
}

test("parseLanguageRanges IS the spec's model on the JDK-checked probe space", { skip }, async () => {
  const artifactBytes = readFileSync(specPath(IANA_EQUIVALENCES_ARTIFACT));
  /** @type {{ languageEquivalenceClasses: string[][], regionVariantEquivalents: [string, string][] }} */
  const artifact = JSON.parse(artifactBytes.toString("utf8"));
  const record = JSON.parse(readFileSync(specPath(IANA_JDK_CHECK), "utf8"));
  const { modelFor } = await import(pathToFileURL(specPath(IANA_MODEL)).href);
  const { probeSpace } = await import(pathToFileURL(specPath(IANA_CANDIDATES)).href);

  // THE SPACE IS THE ONE THE JDK CHECK RAN, OR THIS PROVES LESS THAN IT SAYS. The record names the
  // artifact it checked and the space by digest; a stale record is the spec's red
  // (`check:iana-registry`), and it is asserted here too so this file cannot quietly compare a
  // space nobody held Java to.
  const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
  assert.equal(record.artifact.sha256, artifactSha,
    "generated/iana-jdk-check.json describes a different artifact; re-run the spec's `npm run iana:jdk-check`");
  /** @type {string[]} */
  const space = probeSpace(artifact, record.probeSpace.extraKeys);
  assert.equal(createHash("sha256").update(JSON.stringify(space)).digest("hex"), record.probeSpace.sha256,
    "candidates.mjs rebuilt a different probe space than the JDK check recorded");
  assert.equal(space.length, record.probeSpace.probes);

  // PLUS every artifact member under the suffixes a real header carries — scripts, a region, a
  // variant, private use, and each region/variant subtag the substitutions rewrite — because the
  // space above crosses the TABLE only with nothing, and the prefix walk carries a suffix across.
  const suffixes = ["", "-hans", "-hant", "-us", "-1901", "-x-a",
    ...artifact.regionVariantEquivalents.map(([from]) => from)];
  const probes = [...new Set([...space,
    ...artifact.languageEquivalenceClasses.flat().flatMap((member) => suffixes.map((suffix) => member + suffix))])];

  const model = modelFor(artifact);
  const differing = [];
  let differences = 0;
  let refused = 0;
  let expanded = 0;
  let substituted = 0;

  for (const probe of probes) {
    const expected = outcome(model.parse, probe);
    const actual = outcome(parseLanguageRanges, probe);

    if ("ranges" in expected && "ranges" in actual) {
      const same = expected.ranges.length === actual.ranges.length && expected.ranges.every(([range, weight], index) =>
        range === actual.ranges[index]?.[0] && Object.is(weight, actual.ranges[index]?.[1]));
      if (same) {
        if (expected.ranges.length > probe.split(",").length) expanded += 1;
        // A probe ending in a substitutable subtag whose parse carries the rewritten range.
        const lowered = probe.toLowerCase();
        if (artifact.regionVariantEquivalents.some(([from, to]) => lowered.endsWith(from) &&
          expected.ranges.some(([range]) => range === lowered.slice(0, -from.length) + to))) substituted += 1;
        continue;
      }
    } else if ("error" in expected && "error" in actual) {
      const jsClass = JS_CLASS_FOR.get(/** @type {string} */ (expected.javaClass));
      assert.ok(jsClass !== undefined,
        `the model refuses ${JSON.stringify(probe)} with ${expected.javaClass}, which this file maps to no JS class`);
      if (actual.error === jsClass && actual.message === expected.message) { refused += 1; continue; }
    }

    differences += 1;
    if (differing.length < 20) differing.push({ probe, model: expected, js: actual });
  }

  assert.deepEqual(differing, [],
    `${differences} of ${probes.length} probes where parseLanguageRanges and the spec's model disagree (first 20 shown)`);

  // ANTI-VACUITY. A comparison of two parsers that both refuse everything, or both expand nothing,
  // is green and proves nothing about the table.
  assert.ok(probes.length >= 100_000, `only ${probes.length} probes; the space is not being built`);
  assert.ok(refused > 0, "no probe was refused on both sides; the refusal arm compared nothing");
  assert.ok(expanded > 1_000, `only ${expanded} probes expanded; the language table is not being consulted`);
  assert.ok(substituted > 0, "no probe applied a region/variant substitution; the fourteen pairs compared nothing");
});
