// @ts-check

/**
 * `src/internal/json-parse.js` and the raw-source entry point it sits under.
 *
 * The corpus is the specification: every `parse` case is replayed here from the fixture's VERBATIM
 * bytes or text, and compared with what unmodified lokalized-java 3.0.0 was recorded doing — the
 * exact failure message, or the exact key set.
 *
 * The rest of the file is about ORDER. A parser that produces the right answers but enforces its
 * limits after materialization has missed the milestone, and order is only visible when an input
 * busts more than one boundary at once: each ordering test below is an input that trips two, and
 * asserts which one Java reports.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  LoadingSession,
  parseCatalog,
  parseCatalogSource,
  resolveLimits,
} from "../src/internal/catalog.js";
import {
  MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS,
  appendBoundedPathPart,
  boundedJsonPath,
  parseJsonDocument,
} from "../src/internal/json-parse.js";

/**
 * The sibling spec checkout, guarded.
 *
 * This read used to be BARE, so a clone without `../lokalized-spec` did not skip — it CRASHED the
 * whole file, and with it every self-contained test in it. CI hit exactly that. The other corpus
 * gates in this suite already guard the read and skip; these five did not, which is why five files
 * died while forty tests reported a tidy `# SKIP`.
 *
 * Skipping is only half the answer, and on its own it is the failure mode this project keeps
 * relearning: a suite that quietly shrinks has stopped gating. CI therefore checks out
 * `lokalized-spec` AND fails when ANY test skips, so the skip below can only ever be a local
 * convenience, never a green CI run that verified nothing.
 */
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

const encoder = new TextEncoder();

/** @param {string} text @returns {Uint8Array} */
const bytes = (text) => encoder.encode(text);

/**
 * Java's own wording for a failure raised by the expression compiler, from
 * `LocalizedStringLoader.java:2341` (whole-message) and `:2540` (fragment).
 */
const EXPRESSION_COMPILATION =
  /: unable to parse (?:whole-message alternative|fragment alternative \d+) expression /;

/**
 * Java's own wording for a load refused because a WARNING busted the budget, from
 * `LocalizedStringLoader.java:2940`. The budget lives at this layer and is tested below; only a
 * component that actually emits a warning can trip it.
 */
const WARNING_EMISSION = /: localized strings load exceeds the aggregate maximum of \d+ warnings$/;

/**
 * `parse` cases whose Java outcome needs a capability ABOVE this layer — DERIVED, never listed.
 *
 * This file drives `parseCatalogSource` DIRECTLY, so it sees the bounded reader and the structural
 * validator and nothing else. Both capabilities named here live in `src/parse/index.js`, which
 * composes this layer with the expression compiler and the warning reporter — the conformance runner
 * exercises that composition and every `parse` case reproduces Java through it. Neither exclusion is
 * a JSON-layer difference, and neither can hide one: every other parse case is compared below,
 * message for message, and the count carries a floor.
 *
 * Two properties keep this honest, and both were absent from the hand-written list this replaced:
 *
 *   1. The decision is read off JAVA'S RECORDED FAILURE MESSAGE, so it is a statement about what the
 *      case needs, not about what this port happens to do. A case cannot excuse itself by failing.
 *   2. Every excluded case is still RUN, and an exclusion that this layer has started reproducing
 *      exactly is a test FAILURE, not a silent pass. The list this replaced had rotted exactly that
 *      way: ten of its twelve `warning emission` entries name cases whose Java outcome is a
 *      SUCCESSFUL parse plus warnings, whose key set — all this sweep compares — this layer
 *      reproduces, so they were being excused from a check they already passed.
 *
 * @param {any} testCase
 * @returns {string | null} the missing capability, or null if this layer must reproduce Java
 */
function aboveThisLayer(testCase) {
  const expected = testCase.expected?.parse;

  if (!expected?.failed) return null;

  const message = String(expected.failureMessage ?? "");

  // Java validates alternative expressions inside `parseLocalizedString`. In this port compilation
  // belongs to `src/internal/expression.js` and is driven by `parseStrings`/`createStrings`, so a
  // catalog whose only defect is an unparseable expression is structurally valid at this layer.
  if (EXPRESSION_COMPILATION.test(message)) return "expression compilation";

  // Incomplete-language-form warnings are emitted by `warnOnIncompleteLanguageFormTranslations`
  // after each key is validated, which needs the locale's CLDR form set — data this layer is not
  // allowed to reach. The BUDGET that bounds them is here, and is tested below; the warnings that
  // charge it are reported by `src/parse/index.js`.
  if (WARNING_EMISSION.test(message)) return "warning emission";

  return null;
}

/**
 * The resource a `parse` case names, as the bytes Java's `parse(InputStream, ...)` was handed.
 *
 * @param {any} fixture
 * @param {string} file
 * @returns {Uint8Array}
 */
function resourceBytes(fixture, file) {
  const base64 = fixture.rawFilesBase64?.[file];

  if (base64 !== undefined)
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

  const raw = fixture.rawFiles?.[file];

  if (raw !== undefined) return bytes(raw);

  return bytes(JSON.stringify(fixture.files?.[file]));
}

/** @param {any} fixture @returns {Record<string, number>} */
function limitsFor(fixture) {
  /** @type {Record<string, number>} */
  const limits = {};

  for (const name of [
    "maximumInputBytes",
    "maximumReaderCharacters",
    "maximumJsonNestingDepth",
    "maximumTotalInputBytes",
    "maximumLocalizedStringsFiles",
    "maximumTranslationNodes",
    "maximumWarnings",
  ])
    if (typeof fixture.loadingOptions?.[name] === "number")
      limits[name] = fixture.loadingOptions[name];

  return limits;
}

describe("the raw-source parser against every corpus parse case", { skip: corpusSkip }, () => {
  /**
   * Replay one `parse` case at this layer.
   *
   * @param {any} testCase
   * @returns {string | null} how it disagreed with Java, or null if it reproduced Java exactly
   */
  const disagreement = (testCase) => {
    const fixture = corpus.fixtures[testCase.fixture];
    const expected = testCase.expected.parse;

    /** @type {Map<string, unknown> | null} */
    let definitions = null;
    /** @type {unknown} */
    let thrown = null;

    try {
      definitions = parseCatalogSource(resourceBytes(fixture, testCase.input.file), {
        locale: testCase.input.locale,
        source: testCase.input.source,
        limits: limitsFor(fixture),
      });
    } catch (error) {
      thrown = error;
    }

    if (expected.failed) {
      if (thrown === null) return `${testCase.id}: accepted, expected a rejection`;

      const actual = thrown instanceof Error ? thrown.message : String(thrown);

      return actual === expected.failureMessage
        ? null
        : `${testCase.id}:\n    got  ${JSON.stringify(actual)}\n    want ` +
            `${JSON.stringify(expected.failureMessage)}`;
    }

    if (thrown !== null)
      return `${testCase.id}: rejected (${thrown instanceof Error ? thrown.message : thrown})`;

    const actualKeys = [...(definitions ?? new Map()).keys()].sort();
    const expectedKeys = [...expected.keys].sort();

    return actualKeys.join("\0") === expectedKeys.join("\0")
      ? null
      : `${testCase.id}: parsed key set\n    got  ${JSON.stringify(actualKeys)}\n    want ` +
          `${JSON.stringify(expectedKeys)}`;
  };

  /**
   * Replay one case at this layer and report only whether THIS layer rejected it.
   *
   * Used on the excluded cases, where Java's message is unreachable here by construction but the
   * exclusion's own premise — "structurally valid, defective only above" — is checkable.
   *
   * @param {any} testCase
   * @returns {string | null} the rejection message, or null if this layer accepted the catalog
   */
  const rejectionAtThisLayer = (testCase) => {
    const fixture = corpus.fixtures[testCase.fixture];

    try {
      parseCatalogSource(resourceBytes(fixture, testCase.input.file), {
        locale: testCase.input.locale,
        source: testCase.input.source,
        limits: limitsFor(fixture),
      });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    return null;
  };

  it("reproduces Java's outcome, message for message", () => {
    /** @type {string[]} */
    const differences = [];
    /** @type {string[]} */
    const staleExclusions = [];
    /** @type {Map<string, number>} */
    const excluded = new Map();
    let compared = 0;

    for (const testCase of corpus.cases) {
      if (testCase.operation !== "parse") continue;

      const capability = aboveThisLayer(testCase);

      if (capability !== null) {
        excluded.set(capability, (excluded.get(capability) ?? 0) + 1);

        // Self-policing, in BOTH directions.
        //
        // Outgrown: an exclusion this layer now reproduces exactly is a failure, not a free pass.
        if (disagreement(testCase) === null) {
          staleExclusions.push(
            `${testCase.id}: excused as needing ${capability}, but this layer now reproduces Java ` +
              `exactly — the exclusion has outlived its reason and must be narrowed or deleted`,
          );
          continue;
        }

        // Still earned, for the RIGHT reason. Both exclusions rest on the same claim: the catalog's
        // only defect is above this layer, so this layer must find it STRUCTURALLY VALID. Without
        // this, an exclusion would also swallow a JSON-layer regression that rejected the catalog
        // for some unrelated wrong reason — it disagrees with Java either way, so the check above
        // stays quiet, and the case is excused for a reason that is no longer true.
        const rejection = rejectionAtThisLayer(testCase);

        if (rejection !== null)
          staleExclusions.push(
            `${testCase.id}: excused as needing ${capability}, which claims this layer finds the ` +
              `catalog structurally valid — but this layer REJECTED it: ${rejection}`,
          );

        continue;
      }

      ++compared;

      const difference = disagreement(testCase);

      if (difference !== null) differences.push(difference);
    }

    assert.deepEqual(differences, [], "parse cases disagreeing with Java");
    assert.deepEqual(staleExclusions, [], "exclusions this layer has outgrown");

    // Both capabilities must still be REACHED. A regex that silently stopped matching would push
    // its cases into `differences` and fail loudly, but one that matched a capability out of
    // existence would not, and the exclusion would then be dead code pretending to document a gap.
    for (const capability of ["expression compilation", "warning emission"])
      assert.ok(
        (excluded.get(capability) ?? 0) > 0,
        `no parse case exercises '${capability}' any more — retire the exclusion rather than keep it`,
      );

    // A FLOOR, not an exact count — an exact one fails on corpus GROWTH, the one reason that is
    // unambiguously good news, while saying nothing about correctness. Set AT what the corpus
    // compares today rather than comfortably under it: growth can only raise this number, so the
    // only way to fall below is for a case that is compared today to stop being compared — which
    // is exactly the silent loss worth failing on. It was 97 (the pre-growth exact count) while 116
    // cases actually compared, leaving room for nineteen to slip out of the sweep unnoticed.
    assert.ok(
      compared >= 116,
      `expected at least 116 comparable parse cases, saw ${compared} — cases left the sweep`,
    );
  });

  it("agrees with the decoded-object entry point on every fixture catalog in the corpus", () => {
    // The two doors into the model must not drift. Every fixture catalog is pushed through both:
    // `parseCatalog` over the decoded object, and `parseCatalogSource` over its serialized bytes.
    /** @type {string[]} */
    const differences = [];
    let checked = 0;

    for (const fixture of Object.values(/** @type {Record<string, any>} */ (corpus.fixtures))) {
      for (const [file, decoded] of Object.entries(
        /** @type {Record<string, unknown>} */ (fixture.files ?? {}),
      )) {
        const context = { locale: file, source: file, limits: limitsFor(fixture) };
        /** @type {string} */
        let viaObject;
        /** @type {string} */
        let viaSource;

        try {
          viaObject = [...parseCatalog(decoded, context).keys()].sort().join("\u0000");
        } catch (error) {
          viaObject = `threw: ${error instanceof Error ? error.message : String(error)}`;
        }

        try {
          viaSource = [...parseCatalogSource(bytes(JSON.stringify(decoded)), context).keys()]
            .sort()
            .join("\u0000");
        } catch (error) {
          viaSource = `threw: ${error instanceof Error ? error.message : String(error)}`;
        }

        ++checked;
        if (viaObject !== viaSource)
          differences.push(`${fixture.id ?? "?"}::${file}\n    object ${viaObject}\n    source ${viaSource}`);
      }
    }

    assert.deepEqual(differences, [], "catalogs the two entry points disagree about");
    assert.ok(checked > 1_700, `expected the whole corpus to be exercised, saw ${checked}`);
  });
});

describe("fatal UTF-8", () => {
  const cases = [
    ["a bare continuation byte", [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0x80, 0x22, 0x7d]],
    ["a truncated 3-byte sequence", [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe2, 0x22, 0x7d]],
    ["an overlong encoding of NUL", [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc0, 0x80, 0x22, 0x7d]],
    ["an overlong encoding of '/'", [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe0, 0x80, 0xaf, 0x22, 0x7d]],
    ["an encoded UTF-16 surrogate", [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d]],
    ["a value above U+10FFFF", [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xf5, 0x80, 0x80, 0x80, 0x22, 0x7d]],
  ];

  for (const [what, octets] of cases)
    it(`rejects ${what} instead of substituting U+FFFD`, () => {
      assert.throws(
        () => parseCatalogSource(Uint8Array.from(/** @type {number[]} */ (octets)), { source: "s" }),
        { message: "s: localized strings resource is not valid UTF-8" },
      );
    });

  it("accepts well-formed multi-byte sequences, including astral planes", () => {
    const definitions = parseCatalogSource(bytes('{"Key.é":"\u{1f600} 中"}'), { source: "s" });

    assert.deepEqual([...definitions.keys()], ["Key.é"]);
    assert.equal(definitions.get("Key.é")?.translation, "\u{1f600} 中");
  });
});

describe("BOM and blank handling", () => {
  it("removes exactly one leading BOM", () => {
    const definitions = parseCatalogSource(bytes('﻿{"Key.A":"a"}'), { source: "s" });

    assert.deepEqual([...definitions.keys()], ["Key.A"]);
  });

  it("treats a BOM-only resource as blank, not as empty JSON", () => {
    assert.throws(() => parseCatalogSource(bytes("﻿"), { source: "s" }), {
      message:
        "s: a localized strings file may not be blank; use an empty JSON object ({}) for an empty file",
    });
  });

  it("rejects a SECOND BOM as malformed JSON, at the character it sits on", () => {
    // The decoder is built with `ignoreBOM: true` for exactly this: a decoder that eats one BOM of
    // its own accord, plus Java's one explicit strip, would accept a resource Java rejects.
    assert.throws(() => parseCatalogSource(bytes('﻿﻿{"Key.A":"a"}'), { source: "s" }), {
      message: "s:1:1: unable to parse localized strings file",
    });
  });

  it("rejects an empty and a whitespace-only resource as blank", () => {
    for (const text of ["", " ", "   \r\n\t  \r\n"])
      assert.throws(() => parseCatalogSource(bytes(text), { source: "s" }), {
        message:
          "s: a localized strings file may not be blank; use an empty JSON object ({}) for an empty file",
      });
  });

  it("does not count U+00A0 as JSON whitespace", () => {
    // Java's blank test is space/tab/LF/CR only, so a non-breaking space is a syntax error instead.
    assert.throws(() => parseCatalogSource(bytes(" "), { source: "s" }), {
      message: "s:1:1: unable to parse localized strings file",
    });
  });

  it("accepts an empty JSON object", () => {
    assert.equal(parseCatalogSource(bytes("{}"), { source: "s" }).size, 0);
  });
});

describe("duplicate members", () => {
  it("rejects duplicate root keys rather than keeping either value", () => {
    assert.throws(
      () => parseCatalogSource(bytes('{"Key.A":"first","Key.A":"second","Key.B":"only"}'), { source: "s" }),
      { message: "s: duplicate localized string key 'Key.A' encountered" },
    );
  });

  it("splits the two kinds of duplicate across the two layers, as Java does", () => {
    // Java raises them from two different places with two different messages, so this port does too,
    // and the asymmetry is a contract rather than an oversight: the reader reports duplicates BELOW
    // the root, `parseCatalogMembers` rejects a repeated root key. Pinning it here means a future
    // change that "fixes" the reader to report root duplicates has to change this test on purpose.
    const rootOnly = parseJsonDocument('{"Key.A":"first","Key.A":"second"}', "s");

    assert.deepEqual(rootOnly.duplicates, [], "a repeated ROOT key is not the reader's finding");
    assert.deepEqual(
      rootOnly.members?.map(([key]) => key),
      ["Key.A", "Key.A"],
      "both root members survive, in order, so the catalog parser can see the repeat",
    );

    const nestedOnly = parseJsonDocument('{"Key.A":{"translation":"x","translation":"y"}}', "s");

    assert.equal(nestedOnly.duplicates.length, 1);
    assert.deepEqual(nestedOnly.duplicates[0], {
      name: "translation",
      path: "$.Key.A",
      rootIndex: 0,
    });
  });

  const nested = [
    ['{"Key.A":{"translation":"first","translation":"second"}}', "translation", "$.Key.A"],
    [
      '{"Key.A":{"translation":"I read {{books}}","placeholders":{"books":{"value":"count","translations":{"CARDINALITY_ONE":"book","CARDINALITY_ONE":"tome","CARDINALITY_OTHER":"books"}}}}}',
      "CARDINALITY_ONE",
      "$.Key.A.placeholders.books.translations",
    ],
    [
      '{"Key.A":{"translation":"t","alternatives":[{"count == 0":{"translation":"x","translation":"y"}}]}}',
      "translation",
      "$.Key.A.alternatives[0].count == 0",
    ],
    [
      '{"Key.A":{"translation":"I read {{books}}","placeholders":{"books":{"value":"count","translations":{"CARDINALITY_OTHER":"books"}},"books":{"value":"count","translations":{"CARDINALITY_OTHER":"tomes"}}}}}',
      "books",
      "$.Key.A.placeholders",
    ],
  ];

  for (const [text, name, path] of nested)
    it(`rejects a duplicate '${name}' at ${path}`, () => {
      assert.throws(() => parseCatalogSource(bytes(/** @type {string} */ (text)), { source: "s" }), {
        message: `s: duplicate JSON object member '${name}' encountered at ${path}`,
      });
    });

  it("reports the OUTER duplicate when a duplicated member's value holds one of its own", () => {
    assert.throws(
      () =>
        parseCatalogSource(
          bytes('{"K":{"a":1,"a":{"b":1,"b":2}}}'),
          { source: "s" },
        ),
      { message: "s: duplicate JSON object member 'a' encountered at $.K" },
    );
  });

  it("bounds a hostile member name in the diagnostic", () => {
    const name = "x".repeat(400);
    const deep = `{"K":{"${name}":1,"${name}":2}}`;

    assert.throws(() => parseCatalogSource(bytes(deep), { source: "s" }), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`'${"x".repeat(255)}…'`), error.message);
      return true;
    });
  });
});

/**
 * The bound the M5a gate names by name, and the one no corpus case reaches: every recorded
 * `parse` failure has a short path, so deleting the 4096 cap leaves the whole corpus green.
 * Verified against unmodified lokalized-java 3.0.0 through `LocalizedStringLoader.parse`, whose
 * `boundedJsonPath`/`appendBoundedPathPart` these mirror exactly.
 */
describe("the bounded JSON diagnostic path", () => {
  /** A chain of `levels` nested objects with `length`-character member names, duplicate at the bottom. */
  const chain = (levels, length) => {
    let inner = '{"z":1,"z":2}';
    for (let index = levels - 1; index >= 0; index--) {
      const name = `${"k".repeat(length - String(index).length)}${index}`;
      inner = `{"${name}":${inner}}`;
    }
    return `{"root":${inner}}`;
  };

  /** @param {string} document @returns {string} */
  const duplicatePath = (document) => {
    const found = parseJsonDocument(document, "s").duplicates[0];
    assert.ok(found, "expected a duplicate to be recorded");
    return found.path;
  };

  it("caps a path at 4096 characters with a trailing ellipsis", () => {
    assert.equal(MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS, 4096);

    const path = duplicatePath(chain(40, 102));

    assert.equal(path.length, 4096);
    assert.ok(path.endsWith("…"), path.slice(-16));
    assert.ok(path.startsWith("$.root.kkk"), path.slice(0, 16));
  });

  it("stops growing once capped, however much deeper the duplicate is", () => {
    // The whole point of the cap: a hostile catalog cannot make the diagnostic arbitrarily long.
    // Java returns the identical string for all three depths, and so must this.
    const capped = duplicatePath(chain(40, 102));

    assert.equal(duplicatePath(chain(60, 102)), capped);
    assert.equal(duplicatePath(chain(80, 102)), capped);
  });

  it("leaves a path that fits alone, ellipsis included", () => {
    const path = duplicatePath(chain(40, 101));

    assert.equal(path.length, 4086);
    assert.ok(!path.includes("…"), path.slice(-16));
  });

  it("truncates one oversized member name rather than dropping it", () => {
    const path = duplicatePath(`{"root":{"${"m".repeat(9000)}":{"z":1,"z":2}}}`);

    assert.equal(path.length, 4096);
    assert.equal(path, `$.root.${"m".repeat(4088)}…`);
  });

  it("appends a part only as far as the budget allows", () => {
    assert.equal(appendBoundedPathPart("$", ".a"), "$.a");
    // Exactly at the boundary: the part fits, so no ellipsis is added.
    assert.equal(appendBoundedPathPart("$".repeat(4090), "b".repeat(6)).length, 4096);
    assert.ok(!appendBoundedPathPart("$".repeat(4090), "b".repeat(6)).includes("…"));
    // One over: the last retained character is replaced by the ellipsis.
    assert.equal(appendBoundedPathPart("$".repeat(4090), "b".repeat(7)), `${"$".repeat(4090)}${"b".repeat(5)}…`);
    // Nothing left at all: the part is dropped whole, and no ellipsis is appended twice.
    assert.equal(appendBoundedPathPart("$".repeat(4096), "b"), "$".repeat(4096));
  });

  it("returns the parent unchanged once the parent alone fills the budget", () => {
    const full = "$".repeat(4096);

    assert.equal(boundedJsonPath(full, ".", "member", ""), full);
    assert.equal(boundedJsonPath(full, "[", "0", "]"), full);
  });
  it("compares member names AFTER unescaping them", () => {
    // `"\u0061"` and `"a"` are the same member name. A duplicate check that compared raw source
    // spans instead of decoded names would let this through.
    assert.throws(
      () => parseCatalogSource(bytes('{"K":{"a":1,"\\u0061":2}}'), { source: "s" }),
      { message: "s: duplicate JSON object member 'a' encountered at $.K" },
    );
    assert.throws(
      () => parseCatalogSource(bytes('{"Key.A":"a","\\u004bey.A":"b"}'), { source: "s" }),
      { message: "s: duplicate localized string key 'Key.A' encountered" },
    );
  });

  it("retains ONE finding however many duplicates the document holds", () => {
    // Bounded work, not tidiness. Every retained finding materializes a bounded JSON path — up to
    // 4096 UTF-16 units, rebuilt from the whole container stack — and only `duplicates[0]` can ever
    // be the failure Java reports, because the catalog parser stops at the first root member that
    // carries one. Retaining them all let a 590 KB file of repeated member names at depth 63 cost
    // 384 MB and 172 ms; capped, the same file costs 4.7 MB and 7.5 ms and reports the same thing.
    const name = "n".repeat(60);
    let open = '{"K":';
    let close = "";
    for (let depth = 0; depth < 62; depth++) {
      open += `{"${name}":`;
      close += "}";
    }

    let repeated = "{";
    for (let i = 0; i < 20_000; i++) repeated += `${i ? "," : ""}"a":1`;
    repeated += "}";

    const document = parseJsonDocument(`${open}${repeated}${close}}`, "s");

    assert.equal(document.duplicates.length, 1, "only the first duplicate may be retained");
    assert.equal(document.duplicates[0]?.name, "a");
    assert.equal(document.duplicates[0]?.rootIndex, 0);
    // The one retained path is a real deep one — the cost every suppressed finding would have paid.
    assert.equal(document.duplicates[0]?.path.length, 3785);
    assert.ok(document.duplicates[0] !== undefined && document.duplicates[0].path.length <= 4096);
    // and the diagnostic is unchanged by the cap
    assert.throws(() => parseCatalogSource(bytes(`${open}${repeated}${close}}`), { source: "s" }), {
      message: `s: duplicate JSON object member 'a' encountered at ${document.duplicates[0]?.path}`,
    });
  });

  it("finds duplicates inside array elements at every depth", () => {
    assert.throws(
      () =>
        parseCatalogSource(
          bytes('{"K":{"translation":"t","alternatives":[{"a == 0":"x"},{"b == 0":{"translation":"y","commentary":"c","commentary":"d"}}]}}'),
          { source: "s" },
        ),
      { message: "s: duplicate JSON object member 'commentary' encountered at $.K.alternatives[1].b == 0" },
    );
  });
});

describe("lone surrogates", () => {
  it("rejects a lone high surrogate escape at the position of the escape", () => {
    assert.throws(() => parseCatalogSource(bytes('{"Key.A":"\\ud800"}'), { source: "s" }), {
      message: "s:1:11: unable to parse localized strings file",
    });
  });

  it("rejects a lone LOW surrogate escape, and a high one followed by a non-surrogate", () => {
    assert.throws(() => parseCatalogSource(bytes('{"Key.A":"\\udc00"}'), { source: "s" }), {
      message: "s:1:11: unable to parse localized strings file",
    });
    assert.throws(() => parseCatalogSource(bytes('{"Key.A":"\\ud800x"}'), { source: "s" }), {
      message: "s:1:11: unable to parse localized strings file",
    });
  });

  it("accepts a correctly paired surrogate escape", () => {
    const definitions = parseCatalogSource(bytes('{"Key.A":"\\ud83d\\ude00"}'), { source: "s" });

    assert.equal(definitions.get("Key.A")?.translation, "\u{1f600}");
  });
});

describe("line and column, as Java counts them", () => {
  /** @param {string} text @returns {string} */
  const failure = (text) => {
    try {
      parseCatalogSource(bytes(text), { source: "s" });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    return "accepted";
  };

  it("reports the offending character's line and column", () => {
    assert.equal(failure('{\n  "a": ?\n}'), "s:2:8: unable to parse localized strings file");
  });

  it("counts CRLF as one line break", () => {
    assert.equal(failure('{\r\n"a": 1,\r\n?\r\n}'), "s:3:1: unable to parse localized strings file");
  });

  it("counts a bare CR as a line break", () => {
    assert.equal(failure('{\r"a": 1,\r?\r}'), "s:3:1: unable to parse localized strings file");
  });

  it("reports end of input at one past the last character", () => {
    assert.equal(failure('{"a":'), "s:1:6: unable to parse localized strings file");
  });

  it("rejects trailing content after the document", () => {
    assert.equal(failure('{"a":"b"} {}'), "s:1:11: unable to parse localized strings file");
  });
});

describe("magic keys", () => {
  it("treats __proto__, constructor and prototype as ordinary keys", () => {
    const definitions = parseCatalogSource(
      bytes('{"__proto__":"p","constructor":"c","prototype":"y","Key.Normal":"n"}'),
      { source: "s" },
    );

    assert.deepEqual([...definitions.keys()].sort(), [
      "Key.Normal",
      "__proto__",
      "constructor",
      "prototype",
    ]);
    assert.equal(definitions.get("__proto__")?.translation, "p");
  });

  it("does not let a __proto__ member reach any prototype chain", () => {
    const { value } = parseJsonDocument('{"__proto__":{"polluted":true},"a":{}}', "s");
    const root = /** @type {Record<string, any>} */ (value);

    assert.equal(Object.getPrototypeOf(root), null);
    assert.equal(Object.getPrototypeOf(root["a"]), null);
    assert.equal(/** @type {any} */ ({}).polluted, undefined);
    assert.equal(root["a"].polluted, undefined);
    assert.deepEqual(Object.keys(root), ["__proto__", "a"]);
  });

  it("keeps a duplicated __proto__ a duplicate rather than a silent overwrite", () => {
    assert.throws(
      () => parseCatalogSource(bytes('{"K":{"__proto__":1,"__proto__":2}}'), { source: "s" }),
      { message: "s: duplicate JSON object member '__proto__' encountered at $.K" },
    );
  });
});

describe("the order the boundaries are enforced in", () => {
  it("refuses an out-of-range limit before it reads anything", () => {
    // Java validates in the options builder, so the resource is never touched. `IllegalArgumentException`
    // maps to `RangeError` here: the right kind of value, out of range.
    for (const [limits, message] of /** @type {[any, string][]} */ ([
      [{ maximumJsonNestingDepth: 0 }, "maximumJsonNestingDepth must be between 1 and 128"],
      [{ maximumJsonNestingDepth: 129 }, "maximumJsonNestingDepth must be between 1 and 128"],
      [{ maximumTranslationNodes: -1 }, "maximumTranslationNodes must be nonnegative"],
      [{ maximumLocalizedStringsFiles: 0 }, "maximumLocalizedStringsFiles must be positive"],
      [{ maximumWarnings: -1 }, "maximumWarnings must be nonnegative"],
      [{ maximumInputBytes: 0 }, "maximumInputBytes must be between 1 and Integer.MAX_VALUE - 1"],
      [{ maximumReaderCharacters: 0 }, "maximumReaderCharacters must be positive"],
      [{ maximumTotalInputBytes: 0 }, "maximumTotalInputBytes must be positive"],
    ]))
      assert.throws(
        () => parseCatalogSource(bytes("this is not JSON at all"), { source: "s", limits }),
        { name: "RangeError", message },
        message,
      );
  });

  it("counts bytes before decoding them: an over-long resource that is ALSO invalid UTF-8 reports the bytes", () => {
    const invalid = Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]);

    assert.throws(
      () => parseCatalogSource(invalid, { source: "s", limits: { maximumInputBytes: 4 } }),
      { message: "s: localized strings resource exceeds the maximum size of 4 bytes" },
    );
    // and with room for the bytes, the decode is what fails
    assert.throws(() => parseCatalogSource(invalid, { source: "s" }), {
      message: "s: localized strings resource is not valid UTF-8",
    });
  });

  it("charges the aggregate byte budget WHILE reading, so it beats the per-resource limit", () => {
    // Java reads in 8KiB chunks and charges each one, then decides the per-resource limit once
    // reading stops. A resource over both therefore reports the aggregate.
    assert.throws(
      () =>
        parseCatalogSource(bytes('{"Key.A":"a"}'), {
          source: "s",
          limits: { maximumInputBytes: 12, maximumTotalInputBytes: 5 },
        }),
      { message: "s: localized strings load exceeds the aggregate maximum of 5 input bytes" },
    );
  });

  it("admits a resource exactly at the byte limit and refuses it one byte over", () => {
    const text = '{"Key.A":"a"}';

    assert.equal(
      parseCatalogSource(bytes(text), { source: "s", limits: { maximumInputBytes: 13 } }).size,
      1,
    );
    assert.throws(
      () => parseCatalogSource(bytes(text), { source: "s", limits: { maximumInputBytes: 12 } }),
      { message: "s: localized strings resource exceeds the maximum size of 12 bytes" },
    );
  });

  it("admits a resource exactly at the AGGREGATE byte limit and refuses it one byte over", () => {
    assert.equal(
      parseCatalogSource(bytes('{"Key.A":"a"}'), { source: "s", limits: { maximumTotalInputBytes: 13 } }).size,
      1,
    );
    assert.throws(
      () => parseCatalogSource(bytes('{"Key.A":"a"}'), { source: "s", limits: { maximumTotalInputBytes: 12 } }),
      { message: "s: localized strings load exceeds the aggregate maximum of 12 input bytes" },
    );
  });

  it("charges the aggregate for the bytes actually READ, even when the resource is then rejected", () => {
    // Java reads at most `maximumInputBytes + 1` bytes before deciding the per-resource limit, and
    // every one of them was already charged to the load. A port that charged nothing on rejection
    // would let an unlimited number of oversized resources cost the aggregate budget nothing.
    const session = new LoadingSession({ maximumInputBytes: 4, maximumTotalInputBytes: 1000 });

    assert.throws(() => parseCatalogSource(bytes('{"A":"aaaaaaaaaaaa"}'), { source: "one", session }), {
      message: "one: localized strings resource exceeds the maximum size of 4 bytes",
    });
    assert.equal(session.inputBytes, 5, "maximumInputBytes + 1 bytes were read, so five were charged");
  });

  it("admits nesting exactly at the depth limit and refuses it one level deeper", () => {
    // `{"K": [ ... ]}` is one object plus n-1 arrays, so the document's depth is exactly n. At the
    // limit the depth check passes and the STRUCTURAL error is what surfaces; one deeper it does not.
    const atDepth = (n) => `{"K":${"[".repeat(n - 1)}1${"]".repeat(n - 1)}}`;

    for (const limit of [64, 128]) {
      assert.throws(
        () => parseCatalogSource(bytes(atDepth(limit)), { source: "s", limits: { maximumJsonNestingDepth: limit } }),
        { message: "s: either a translation string or object value is required for key 'K'" },
        `depth ${limit} must clear a limit of ${limit}`,
      );
      assert.throws(
        () =>
          parseCatalogSource(bytes(atDepth(limit + 1)), {
            source: "s",
            limits: { maximumJsonNestingDepth: limit },
          }),
        { message: `s: JSON nesting depth exceeds the maximum of ${limit}` },
      );
    }
  });

  it("charges a placeholder and an alternative BEFORE validating either", () => {
    // Java's `addTranslationNodes(1, ...)` is the first statement of both loop bodies, ahead of the
    // reserved-name check and the null check. An input that busts the budget AND is invalid must
    // therefore report the budget; with one more node of room it reports the defect instead.
    const reserved =
      '{"A":{"translation":"x","placeholders":{"CARDINALITY_ONE":{"value":"c","translations":{}}}}}';

    assert.throws(
      () => parseCatalogSource(bytes(reserved), { source: "s", limits: { maximumTranslationNodes: 1 } }),
      { message: "s: localized strings load exceeds the aggregate maximum of 1 translation nodes" },
    );
    assert.throws(
      () => parseCatalogSource(bytes(reserved), { source: "s", limits: { maximumTranslationNodes: 2 } }),
      { message: /^s: invalid placeholder 'CARDINALITY_ONE'\./ },
    );

    const nullAlternative = '{"A":{"alternatives":[null]}}';

    assert.throws(
      () => parseCatalogSource(bytes(nullAlternative), { source: "s", limits: { maximumTranslationNodes: 1 } }),
      { message: "s: localized strings load exceeds the aggregate maximum of 1 translation nodes" },
    );
    assert.throws(
      () => parseCatalogSource(bytes(nullAlternative), { source: "s", limits: { maximumTranslationNodes: 2 } }),
      { message: "s: alternative values cannot be null. Key is 'A'" },
    );
  });

  it("counts a duplicated ROOT key against the node budget, as JsonObject.size() does", () => {
    // MinimalJson's `JsonObject.add` appends unconditionally, so `size()` counts both occurrences and
    // the budget sees two nodes. A parser that deduplicated before charging would undercount.
    assert.throws(
      () => parseCatalogSource(bytes('{"A":1,"A":2}'), { source: "s", limits: { maximumTranslationNodes: 1 } }),
      { message: "s: localized strings load exceeds the aggregate maximum of 1 translation nodes" },
    );
  });

  it("lets a SYNTAX error anywhere in the document beat the node budget", () => {
    // Java parses the whole document before it charges anything, so a truncated file with a zero
    // node budget reports the truncation. This is why the reader may not stop at the first duplicate.
    assert.throws(
      () => parseCatalogSource(bytes('{"a":1,'), { source: "s", limits: { maximumTranslationNodes: 0 } }),
      { message: "s:1:8: unable to parse localized strings file" },
    );
    assert.throws(
      () => parseCatalogSource(bytes("[1,2,3]"), { source: "s", limits: { maximumTranslationNodes: 0 } }),
      { message: "s: a localized strings file must be comprised of a single JSON object" },
    );
  });

  it("bounds text input by characters instead of bytes", () => {
    assert.throws(
      () => parseCatalogSource('{"Key.A":"a"}', { source: "s", limits: { maximumReaderCharacters: 12 } }),
      { message: "s: localized strings resource exceeds the maximum size of 12 characters" },
    );
    assert.equal(
      parseCatalogSource('{"Key.A":"a"}', { source: "s", limits: { maximumReaderCharacters: 13 } }).size,
      1,
    );
  });

  it("counts nesting over the raw text, so a too-deep resource that is ALSO unparseable reports the depth", () => {
    assert.throws(
      () => parseCatalogSource(bytes('{"a":[[[ this is not json'), { source: "s", limits: { maximumJsonNestingDepth: 2 } }),
      { message: "s: JSON nesting depth exceeds the maximum of 2" },
    );
  });

  it("does not count braces that are inside a JSON string, or escaped quotes as terminators", () => {
    // The nesting prepass is a character scan, so it has to track strings and their escapes exactly
    // as Java's does: a translation full of braces is not nesting, and a `\"` does not end a string.
    assert.equal(
      parseCatalogSource(bytes('{"Key.A":"{[{[ \\" ]}]} braces"}'), {
        source: "s",
        limits: { maximumJsonNestingDepth: 1 },
      }).size,
      1,
    );
  });

  it("counts nesting before duplicates are considered", () => {
    assert.throws(
      () =>
        parseCatalogSource(bytes('{"K":{"a":{"b":1},"a":2}}'), {
          source: "s",
          limits: { maximumJsonNestingDepth: 2 },
        }),
      { message: "s: JSON nesting depth exceeds the maximum of 2" },
    );
  });

  it("charges the node budget before ANY definition is materialized", () => {
    // `{"Key.A": 42}` is both over a zero node budget and structurally invalid. Java charges the
    // root member count first, so the budget is what fails — proof the limit precedes the model.
    assert.throws(
      () => parseCatalogSource(bytes('{"Key.A":42}'), { source: "s", limits: { maximumTranslationNodes: 0 } }),
      { message: "s: localized strings load exceeds the aggregate maximum of 0 translation nodes" },
    );
    assert.throws(() => parseCatalogSource(bytes('{"Key.A":42}'), { source: "s" }), {
      message: "s: either a translation string or object value is required for key 'Key.A'",
    });
  });

  it("lets a structural error under an EARLIER key beat a duplicate under a later one", () => {
    // Java's duplicate walk runs per root member, interleaved with the structural parse of the
    // members before it. A parser that rejected every duplicate up front would report the wrong one.
    assert.throws(
      () => parseCatalogSource(bytes('{"A":42,"B":{"t":1,"t":2}}'), { source: "s" }),
      { message: "s: either a translation string or object value is required for key 'A'" },
    );
  });

  it("lets a duplicate under a key beat that same key's own structural error", () => {
    assert.throws(
      () => parseCatalogSource(bytes('{"A":{"note":1,"note":2}}'), { source: "s" }),
      { message: "s: duplicate JSON object member 'note' encountered at $.A" },
    );
  });

  it("parses an earlier root key before reporting a duplicate root key", () => {
    // The first occurrence's value is the one Java parses; a last-wins materialization would have
    // reported the duplicate instead of the first value's defect.
    assert.throws(
      () => parseCatalogSource(bytes('{"A":42,"A":"fine"}'), { source: "s" }),
      { message: "s: either a translation string or object value is required for key 'A'" },
    );
  });
});

describe("the load-wide session", () => {
  it("admits files up to the limit and refuses the next one before it is read", () => {
    const session = new LoadingSession({ maximumLocalizedStringsFiles: 2 });

    parseCatalogSource(bytes('{"A":"a"}'), { source: "one", session });
    parseCatalogSource(bytes('{"B":"b"}'), { source: "two", session });

    assert.throws(() => parseCatalogSource(bytes('{"C":"c"}'), { source: "three", session }), {
      message: "three: localized strings load exceeds the aggregate localized strings file limit of 2",
    });
  });

  it("accumulates translation nodes and input bytes across files", () => {
    const session = new LoadingSession({ maximumTranslationNodes: 3 });

    parseCatalogSource(bytes('{"A":"a","B":"b"}'), { source: "one", session });

    assert.equal(session.translationNodes, 2);
    assert.throws(() => parseCatalogSource(bytes('{"C":"c","D":"d"}'), { source: "two", session }), {
      message: "two: localized strings load exceeds the aggregate maximum of 3 translation nodes",
    });

    const bytesSession = new LoadingSession({ maximumTotalInputBytes: 12 });

    parseCatalogSource(bytes('{"A":"a"}'), { source: "one", session: bytesSession });

    assert.equal(bytesSession.inputBytes, 9);
    assert.throws(
      () => parseCatalogSource(bytes('{"B":"b"}'), { source: "two", session: bytesSession }),
      { message: "two: localized strings load exceeds the aggregate maximum of 12 input bytes" },
    );
  });

  it("refuses an over-budget warning INSTEAD OF delivering it", () => {
    const session = new LoadingSession({ maximumWarnings: 1 });
    /** @type {unknown[]} */
    const delivered = [];
    const handler = (/** @type {unknown} */ warning) => delivered.push(warning);

    session.warn({ source: "one" }, handler);

    assert.equal(delivered.length, 1);
    assert.throws(() => session.warn({ source: "two" }, handler), {
      message: "two: localized strings load exceeds the aggregate maximum of 1 warnings",
    });
    assert.equal(delivered.length, 1, "the over-limit warning must never reach the handler");
  });

  it("defaults every limit to Java's documented value", () => {
    assert.deepEqual(resolveLimits(), {
      maximumInputBytes: 8 * 1024 * 1024,
      maximumReaderCharacters: 8 * 1024 * 1024,
      maximumJsonNestingDepth: 64,
      maximumTotalInputBytes: 32 * 1024 * 1024,
      maximumLocalizedStringsFiles: 256,
      maximumTranslationNodes: 100_000,
      maximumWarnings: 1_000,
    });
  });
});

describe("the parser never evaluates catalog text", () => {
  it("contains no eval and no Function constructor", () => {
    const source = readFileSync(new URL("../src/internal/json-parse.js", import.meta.url), "utf8");

    assert.ok(!/\beval\s*\(/.test(source), "eval( must not appear");
    assert.ok(!/new\s+Function\b/.test(source), "new Function must not appear");
    assert.ok(
      !/\bJSON\.parse\s*\(/.test(source),
      "JSON.parse must not be CALLED: it cannot meet this contract",
    );
  });
});
