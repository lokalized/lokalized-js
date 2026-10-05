// @ts-check
/**
 * `mergeParsedStringsFiles` — plan 2.3:172-190 and 3.6:1477-1496.
 *
 * The last name the surface gates had recorded as promised-and-undelivered. It assembles exact-locale
 * shards: an application that splits translations by route or namespace parses each separately and
 * merges before construction, because V1 manifests and the runtime loader model ONE assembled
 * resource per locale.
 *
 * **THE EQUALITY PREDICATE WAS MEASURED AGAINST REAL JAVA, AND THE MEASUREMENT CONTRADICTS THE
 * OBVIOUS READING OF THE PLAN.** Plan 3.6:1489 describes the dedup rule as covering the "complete
 * validated model (including commentary and declaration order …)", which reads as making a
 * placeholder map authored `{z, a}` unequal to one authored `{a, z}`. Executed against
 * `lokalized-java` 3.0.0's own `LocalizedString#equals` on the pinned JDK (probe in
 * `planning/M9-STATUS.md`):
 *
 *     placeholder map insertion order {z,a} vs {a,z}             EQUAL
 *     translations-by-language-form order MASC,FEM vs FEM,MASC   EQUAL
 *     LinkedHashMap vs HashMap for the same entries              EQUAL
 *     alternatives order [x,y] vs [y,x]                          NOT EQUAL
 *     commentary null vs "note"                                  NOT EQUAL
 *
 * `LocalizedString.java:168-181` shows the mechanism: `placeholderDefinitions` is compared with
 * `Objects.equals` on a MAP, which is order-insensitive, while `alternatives` is a LIST walked by
 * index. So "declaration order" is the alternatives' order and nothing else — and a comparison that
 * also honoured map order would be STRICTLY STRICTER THAN JAVA, refusing a merge of two shards a
 * Java deployment accepts. Both halves are asserted below, because either alone is satisfied by a
 * predicate that is wrong in the other direction.
 *
 * **LAST-WRITE-WINS IS FORBIDDEN (plan 2.3:190)** and that is the clause most likely to be
 * implemented wrongly on purpose: picking a winner is what every other merge helper in the world
 * does, and it turns an authoring bug into a mystery at render time. There is no test here that
 * asserts which definition wins, because there is no winner to assert.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mergeParsedStringsFiles, parseStrings } from "../src/parse/index.js";
import { StringsParseError } from "../src/internal/parse-diagnostics.js";

/** @param {Record<string, unknown>} body @param {string} source @param {string} [locale] */
const shard = (body, source, locale = "en") =>
  parseStrings(JSON.stringify(body), { locale, source });

/** The two-placeholder definition the order probes vary. */
const PLACEHOLDERS = {
  z: { value: "g", translations: { GENDER_MASCULINE: "He", GENDER_FEMININE: "She" } },
  a: { value: "n", translations: { CARDINALITY_ONE: "1", CARDINALITY_OTHER: "n" } },
};
const REVERSED_PLACEHOLDERS = {
  a: { value: "n", translations: { CARDINALITY_OTHER: "n", CARDINALITY_ONE: "1" } },
  z: { value: "g", translations: { GENDER_FEMININE: "She", GENDER_MASCULINE: "He" } },
};

describe("the locale rule is exact, after normalization", () => {
  test("`pt` and `pt-PT` are refused, and the message says why", () => {
    // Plan 2.3:173 — "their cardinal rules differ for 0, 0.0, and 1.5". An entry is evaluated under
    // the locale of the file that supplied it, so merging across two tags silently re-evaluates half
    // the catalog under the wrong plural rules.
    assert.throws(() => mergeParsedStringsFiles([
      shard({ K: "a" }, "pt.json", "pt"), shard({ L: "b" }, "pt-PT.json", "pt-PT"),
    ]), (error) => {
      assert.ok(error instanceof StringsParseError);
      assert.match(error.message, /'pt' and 'pt-PT' were both supplied/);
      return true;
    });
  });

  test("a shared language, or a related one, is not enough", () => {
    // Plan 2.3:172 — "Matching primary language, likely script, or `equivalent(a, b)` is
    // insufficient." Without these the rule reads as "same language" rather than "same tag".
    for (const [left, right] of [["nb", "no"], ["en", "en-US"], ["zh-Hans", "zh-Hant"]])
      assert.throws(() => mergeParsedStringsFiles([
        shard({ K: "a" }, "l.json", left), shard({ L: "b" }, "r.json", right),
      ]), StringsParseError, `${left} + ${right} merged`);
  });

  test("`iw` and `he` ARE one locale, and so are `en-us` and `en-US` — but the PARSER is what says so", () => {
    // **MEASURED, AND THE MEASUREMENT MOVED THIS TEST'S CLAIM.** `parseStrings` normalizes at its
    // own door: handed `iw` it returns a file whose `locale` is `he`, and handed `en-us` it returns
    // `en-US`. So these two merges succeed because the shards ALREADY agree, not because the merge
    // canonicalized anything — an ablation that removed the merge's own `normalizeTag` left this
    // green and said so. What it does establish is the boundary of the rule above: `nb`/`no` are not
    // canonicalized onto each other and stay separate, while a deprecated code and its modern
    // spelling are the same tag and merging them changes no plural rule.
    const hebrew = mergeParsedStringsFiles([
      shard({ K: "a" }, "iw.json", "iw"), shard({ L: "b" }, "he.json", "he"),
    ]);
    assert.equal(hebrew.locale, "he");
    assert.deepEqual(hebrew.sources, ["iw.json", "he.json"]);

    const english = mergeParsedStringsFiles([
      shard({ K: "a" }, "l.json", "en-us"), shard({ L: "b" }, "r.json", "en-US"),
    ]);
    assert.equal(english.locale, "en-US");
    assert.deepEqual(english.strings.map((definition) => definition.key), ["K", "L"]);
  });

  test("the merge normalizes on its OWN account, which only a hand-built file can reach", () => {
    // **THE TEST THE ABLATION ASKED FOR.** `ParsedStringsFile` is a STRUCTURAL type — plan 3.4:713
    // says so in as many words, so that a value from one installed copy stays usable by another —
    // and nothing stops a caller building one. Every file the parser produces already carries a
    // canonical tag, so the merge's own `normalizeTag` is unreachable from `parseStrings` output and
    // an ablation removing it turned ZERO tests red. This is the input that reaches it: a hand-built
    // shard spelled `EN-us`, which must be one locale with a parsed `en-US` rather than a refusal.
    const parsed = shard({ K: "a" }, "parsed.json", "en-US");
    const handBuilt = { ...parsed, locale: "EN-us", sources: ["hand.json"],
      strings: [{ key: "L", translation: "b" }], originsByKey: { L: ["hand.json"] } };

    const merged = mergeParsedStringsFiles([parsed, /** @type {any} */ (handBuilt)]);
    assert.equal(merged.locale, "en-US");
    assert.deepEqual(merged.strings.map((definition) => definition.key), ["K", "L"]);

    // AND THE CONTROL: a hand-built tag that is not the same locale after normalization is still
    // refused, so "it normalizes" is not satisfied by a merge that stopped comparing.
    assert.throws(() => mergeParsedStringsFiles([parsed,
      /** @type {any} */ ({ ...handBuilt, locale: "EN-gb" })]), StringsParseError);
  });
});

describe("a repeated key is deduplicated or refused, never resolved", () => {
  test("an identical definition unions its origins in caller order", () => {
    const merged = mergeParsedStringsFiles([
      shard({ "App.Title": "Shop", "Nav.Home": "Home" }, "global.json"),
      shard({ "Checkout.Cta": "Pay", "Nav.Home": "Home" }, "checkout.json"),
    ]);
    assert.deepEqual(merged.strings.map((definition) => definition.key),
      ["App.Title", "Nav.Home", "Checkout.Cta"], "caller order, first occurrence retained");
    assert.deepEqual(merged.originsByKey["Nav.Home"], ["global.json", "checkout.json"]);
    assert.deepEqual(merged.originsByKey["App.Title"], ["global.json"]);
    assert.deepEqual(merged.sources, ["global.json", "checkout.json"]);
  });

  test("a conflicting definition is refused with BOTH origins named", () => {
    assert.throws(() => mergeParsedStringsFiles([
      shard({ "Nav.Home": "Home" }, "global.json"),
      shard({ "Nav.Home": "Accueil" }, "other.json"),
    ]), (error) => {
      assert.ok(error instanceof StringsParseError);
      assert.match(error.message, /key 'Nav\.Home'/);
      assert.match(error.message, /\[global\.json\] and \[other\.json\]/,
        "plan 3.6:1492 — the exact prior and new origins");
      return true;
    });
  });

  test("the union is deduplicated, so re-merging cannot grow an origin list without end", () => {
    const one = shard({ K: "a" }, "one.json");
    const merged = mergeParsedStringsFiles([one, one, one]);
    assert.deepEqual(merged.originsByKey.K, ["one.json"]);
    // The SOURCE list is not deduplicated, deliberately: plan 2.3:186 says the helper "preserves all
    // source names", and three shards really were supplied.
    assert.deepEqual(merged.sources, ["one.json", "one.json", "one.json"]);
  });
});

describe("structural equality is Java's, measured rather than assumed", () => {
  test("placeholder and translation-map ORDER does not make a conflict", () => {
    // Java: EQUAL, because both are Maps. A comparison honouring key order would refuse this merge
    // and be strictly stricter than the implementation this port exists to reproduce.
    const merged = mergeParsedStringsFiles([
      shard({ K: { translation: "{{z}}{{a}}", placeholders: PLACEHOLDERS } }, "za.json"),
      shard({ K: { translation: "{{z}}{{a}}", placeholders: REVERSED_PLACEHOLDERS } }, "az.json"),
    ]);
    assert.deepEqual(merged.originsByKey.K, ["za.json", "az.json"]);
    assert.equal(merged.strings.length, 1);
  });

  test("ALTERNATIVES order does", () => {
    // Java: NOT EQUAL, because alternatives are a List walked by index. This is the half that makes
    // the test above a measurement rather than a blanket "order never matters".
    const alternatives = [{ "x == 1": { translation: "one" } }, { "x == 2": { translation: "two" } }];
    assert.throws(() => mergeParsedStringsFiles([
      shard({ K: { translation: "t", alternatives } }, "ax.json"),
      shard({ K: { translation: "t", alternatives: [...alternatives].reverse() } }, "xa.json"),
    ]), StringsParseError);
    // THE CONTROL: the same order merges, so "alternatives conflict" is not satisfied by a predicate
    // that refuses every definition carrying one.
    assert.equal(mergeParsedStringsFiles([
      shard({ K: { translation: "t", alternatives } }, "ax.json"),
      shard({ K: { translation: "t", alternatives } }, "ax2.json"),
    ]).strings.length, 1);
  });

  test("commentary is part of the model", () => {
    // Java: NOT EQUAL. Plan 3.6:1489 names it explicitly, and it is the field most likely to be
    // dropped from a comparison as "just a note".
    assert.throws(() => mergeParsedStringsFiles([
      shard({ K: { translation: "t", commentary: "note" } }, "a.json"),
      shard({ K: { translation: "t" } }, "b.json"),
    ]), StringsParseError);
  });

  test("a field the model does not have is not silently ignored", () => {
    // ANTI-WIDENING. The predicate is a generic walk, so a member that exists on one side and not
    // the other is a difference by construction. A hand-written list of compared fields would pass
    // this and go stale the day the model grows one — the shape S22 measured when widening
    // `catalogIdentityInputFor` changed no fingerprint and no behaviour.
    const parsed = shard({ K: "t" }, "a.json");
    const widened = {
      ...parsed, sources: ["b.json"],
      strings: [{ ...parsed.strings[0], surprise: "new model field" }],
      originsByKey: { K: ["b.json"] },
    };
    assert.throws(() => mergeParsedStringsFiles([parsed, /** @type {any} */ (widened)]),
      StringsParseError);
  });
});

describe("what it carries, and what it refuses to reconstruct", () => {
  test("warnings are preserved in caller order and counted whole", () => {
    // An incomplete CARDINALITY map is the warning to reach for here, measured rather than guessed:
    // an incomplete GENDER map produces none, because gender has no completeness rule to be short
    // of. `INCOMPLETE_CARDINALITY_TRANSLATIONS` is what a missing `CARDINALITY_OTHER` raises.
    const warned = (/** @type {string} */ source) => shard({
      [`K.${source}`]: {
        translation: "{{p}}",
        placeholders: { p: { value: "n", translations: { CARDINALITY_ONE: "one" } } },
      },
    }, source);
    const first = warned("first.json");
    const second = warned("second.json");
    assert.ok(first.warnings.length > 0, "the fixture must actually warn");

    const merged = mergeParsedStringsFiles([first, second]);
    assert.equal(merged.warnings.length, first.warnings.length + second.warnings.length);
    assert.deepEqual(merged.warnings.map((warning) => warning.source),
      [...first.warnings.map((w) => w.source), ...second.warnings.map((w) => w.source)]);
  });

  test("the three model limits apply", () => {
    const files = [shard({ A: "a" }, "a.json"), shard({ B: "b" }, "b.json"), shard({ C: "c" }, "c.json")];
    assert.throws(() => mergeParsedStringsFiles(files, { limits: { maximumLocalizedStringsFiles: 2 } }),
      /aggregate localized strings file limit of 2/);
    assert.throws(() => mergeParsedStringsFiles(files, { limits: { maximumTranslationNodes: 2 } }),
      /translation nodes/);
    // THE CONTROL for both, or "a limit refuses" is satisfied by a merge that refuses everything.
    assert.equal(mergeParsedStringsFiles(files, {
      limits: { maximumLocalizedStringsFiles: 3, maximumTranslationNodes: 64 },
    }).strings.length, 3);
  });

  test("the warning budget applies to what is carried", () => {
    const warned = (/** @type {string} */ source) => shard({
      [`K.${source}`]: {
        translation: "{{p}}",
        placeholders: { p: { value: "n", translations: { CARDINALITY_ONE: "one" } } },
      },
    }, source);
    const files = [warned("a.json"), warned("b.json")];
    const carried = files[0].warnings.length + files[1].warnings.length;
    assert.throws(() => mergeParsedStringsFiles(files, { limits: { maximumWarnings: carried - 1 } }),
      /maximum of \d+ warnings/);
    assert.equal(mergeParsedStringsFiles(files, { limits: { maximumWarnings: carried } }).warnings.length,
      carried);
  });

  test("the RAW limits are not applied, because there is no text left to bound", () => {
    // Plan 3.6:1493 — "normalized `ParsedStringsFile` values do not pretend to reconstruct them from
    // lost whitespace, escapes, or BOMs". A merge that enforced a byte or nesting bound would be
    // enforcing it against a value that never had those properties.
    const deep = shard({ K: { translation: "t", alternatives: [{ "x == 1": { translation: "one" } }] } }, "a.json");
    assert.doesNotThrow(() => mergeParsedStringsFiles([deep], /** @type {any} */ ({
      limits: { maximumJsonNestingDepth: 1, maximumInputBytes: 1, maximumReaderCharacters: 1 },
    })));
  });
});

describe("its own output merges again", () => {
  test("re-merging preserves every diagnostic and is associative on content", () => {
    // Plan 3.6:1492 — "Its own output can therefore be merged again without losing diagnostics."
    const a = shard({ A: "a", Shared: "s" }, "a.json");
    const b = shard({ B: "b", Shared: "s" }, "b.json");
    const c = shard({ C: "c" }, "c.json");

    const stepwise = mergeParsedStringsFiles([mergeParsedStringsFiles([a, b]), c]);
    const flat = mergeParsedStringsFiles([a, b, c]);

    assert.deepEqual(stepwise.strings, flat.strings);
    assert.deepEqual(stepwise.originsByKey, flat.originsByKey);
    assert.deepEqual(stepwise.sources, flat.sources);
    assert.deepEqual(stepwise.originsByKey.Shared, ["a.json", "b.json"],
      "the shared key's origins survived a second pass");
  });
});

describe("refusals at the door", () => {
  test("no input at all", () => {
    assert.throws(() => mergeParsedStringsFiles([]), /at least one parsed strings file/);
    assert.throws(() => mergeParsedStringsFiles(/** @type {any} */ (null)), StringsParseError);
  });

  test("a value that is not a parsed strings file", () => {
    for (const bad of [{}, { $lokalized: "something-else" }, { $lokalized: "parsed-strings-file" },
      { ...shard({ K: "a" }, "a.json"), strings: "not an array" }])
      assert.throws(() => mergeParsedStringsFiles([/** @type {any} */ (bad)]),
        /is not a parsed strings file/, JSON.stringify(bad));
  });

  test("a fabricated file whose model is invalid is revalidated and refused", () => {
    // The envelope check above is shallow by design; the model walk is what catches a definition
    // that no parser would have produced. Plan 3.6:1496 — merge "revalidate[s] only model/file/node/
    // warning limits", and this is the model half.
    // `{{missing}}` would NOT do: an unresolved placeholder reference is filled from the caller's
    // context at render time and is perfectly valid, which the first draft of this test got wrong.
    // A definition with neither a translation nor an alternative is genuinely unconstructible.
    const fabricated = { ...shard({ K: "a" }, "a.json"), strings: [{ key: "K" }] };
    assert.throws(() => mergeParsedStringsFiles([/** @type {any} */ (fabricated)]), StringsParseError);
  });
});
