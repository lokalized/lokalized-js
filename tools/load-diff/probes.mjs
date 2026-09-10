// @ts-check
/**
 * The `diff:load` probe space.
 *
 * EVERY PROBE IS SINGLE-FAULT, and the rule is not stylistic. Java's enumeration order is the
 * filesystem's; the loader is eager and single-pass; so a directory with two faults answers with
 * whichever the walk reached first, and no JS runtime reproduces that order. A two-fault probe would
 * be green or red according to the host, which is not a comparison. Each entry says why it is
 * single-fault in its `discriminates` line where that is not obvious.
 *
 * FILE BODY CONVENTIONS: a string is written as a file; `null` creates a DIRECTORY of that name;
 * `"@->target"` creates a symlink. Directories and symlinks are here because the corpus transport
 * cannot express either — `build.mjs` writes every fixture file with a flat `writeFileSync` — which
 * is precisely why the child-directory rule has never been tested by anything.
 */

/** A catalog whose placeholder supplies only CARDINALITY_ONE, so any locale with more forms warns. */
const INCOMPLETE_CARDINALITY = JSON.stringify({
  Items: {
    translation: "{{count}} {{noun}}",
    placeholders: { noun: { value: "count", translations: { CARDINALITY_ONE: "item" } } },
  },
});

/** Two placeholders in one file, both incomplete: two warnings whose ORDER is JSON declaration order. */
const TWO_INCOMPLETE_PLACEHOLDERS = JSON.stringify({
  First: {
    translation: "{{count}} {{alpha}}",
    placeholders: { alpha: { value: "count", translations: { CARDINALITY_ONE: "a" } } },
  },
  Second: {
    translation: "{{count}} {{beta}}",
    placeholders: { beta: { value: "count", translations: { CARDINALITY_ONE: "b" } } },
  },
});

const ONE_KEY = JSON.stringify({ A: "a" });

export const PROBES = [
  // ---- blind spot 1: the discovery budget charges entries it then SKIPS ----------------------
  {
    name: "discovery-charges-skipped-entries",
    files: { en: ONE_KEY, "README.md": "not a locale" },
    options: { maximumDiscoveryEntries: 1 },
    discriminates:
      "a port that charges only LOADABLE entries: it would charge 1 for `en`, never charge `README.md`, and load successfully",
  },
  {
    name: "discovery-charges-skipped-entries-control",
    files: { en: ONE_KEY, "README.md": "not a locale" },
    options: { maximumDiscoveryEntries: 2 },
    discriminates: "the control: at a budget of 2 the same directory must LOAD, so the probe above is not passing on an unrelated refusal",
  },
  {
    name: "discovery-charges-subdirectories",
    files: { en: ONE_KEY, nested: null },
    options: { maximumDiscoveryEntries: 1 },
    discriminates: "a port that skips subdirectories BEFORE charging: a child directory costs one entry like any other child",
  },
  {
    name: "discovery-budget-is-inclusive",
    files: { en: ONE_KEY, fr: ONE_KEY },
    options: { maximumDiscoveryEntries: 2 },
    discriminates: "an off-by-one on the ceiling: N entries must pass at a budget of exactly N",
  },

  // ---- blind spot 2: the child-directory skip, which NO corpus fixture reaches ----------------
  {
    name: "child-directory-named-invalid-json-is-skipped",
    files: { en: ONE_KEY, "zzz-bogus.json": null },
    options: {},
    discriminates:
      "a port that tests the NAME before the file type: as a directory this is skipped silently, while the identically-named regular file refuses the whole load (the next probe)",
  },
  {
    name: "child-file-named-invalid-json-refuses",
    files: { en: ONE_KEY, "zzz-bogus.json": "{}" },
    options: {},
    discriminates: "the control for the pair above — same name, different file type, opposite outcome. Single-fault: `en` is valid",
  },
  {
    name: "child-directory-named-like-a-locale-is-skipped",
    files: { en: ONE_KEY, "fr.json": null },
    options: {},
    discriminates: "a port that would load a DIRECTORY as a locale: `fr` must not appear in the result",
  },

  // ---- blind spot 3: the syntactic tag pre-filter ---------------------------------------------
  {
    name: "underscore-name-refuses",
    files: { en: ONE_KEY, "en_US.json": "{}" },
    options: {},
    discriminates: "a port whose tag test accepts `_` as a subtag separator; the regex stage rejects it before any parse",
  },
  {
    name: "hyphen-name-loads",
    files: { "en-US": ONE_KEY },
    options: {},
    discriminates: "the control for the underscore probe: the same shape spelled correctly must load, as `en-US`",
  },
  {
    name: "nine-character-private-use-refuses",
    files: { en: ONE_KEY, "x-abcdefghi.json": "{}" },
    options: {},
    discriminates:
      "a port that runs the `x-` short circuit BEFORE the strict parse: the strict parse is the only stage that rejects a 9-character private-use subtag",
  },
  {
    name: "eight-character-private-use-loads",
    files: { "x-abcdefgh": ONE_KEY },
    options: {},
    discriminates: "the control: one character shorter must LOAD, which is what makes the probe above about length rather than about `x-`",
  },
  {
    name: "double-json-suffix-refuses",
    files: { en: ONE_KEY, "fr.json.json": "{}" },
    options: {},
    discriminates: "a port that strips every `.json` suffix rather than exactly one",
  },
  {
    name: "extensionless-and-mixed-case-suffix-load",
    files: { en: ONE_KEY, "de.Json": ONE_KEY, "IT.JSON": ONE_KEY },
    options: {},
    discriminates: "the suffix is optional and case-insensitive while the STEM canonicalizes: `IT.JSON` must key as `it`. Single-fault: no entry here is a fault",
  },
  {
    name: "hidden-file-with-invalid-json-name-is-skipped",
    files: { en: ONE_KEY, ".zzz-bogus.json": "{}" },
    options: {},
    discriminates:
      "a port that maps names to tags before testing for a leading dot: hidden wins, so this is silent where the un-hidden twin refuses",
  },
  {
    name: "legacy-language-code-canonicalizes",
    files: { iw: ONE_KEY },
    options: {},
    discriminates: "a port missing the JDK's legacy language table: `iw` must key as `he`",
  },
  {
    name: "unknown-but-well-formed-tag-refuses",
    files: { en: ONE_KEY, "zz.json": "{}" },
    options: {},
    discriminates: "a port that omits the pinned-CLDR known-tag stage: `zz` is well-formed BCP 47 and still not a language",
  },

  // ---- blind spot 4: budgets that accumulate ACROSS files -------------------------------------
  {
    // ONE inode, TWO names. Both entries resolve to the same real path, so the refusal message has no
    // order-dependent slot at all — which is strictly better than masking one out, and is why this
    // probe compares its message verbatim where the first draft could not.
    name: "translation-nodes-accumulate-across-files",
    payloads: { body: ONE_KEY },
    files: { en: "@payload:body", fr: "@payload:body" },
    options: { maximumTranslationNodes: 1 },
    discriminates:
      "a port with a FRESH session per file: each file needs 1 node and passes alone, so only a shared session refuses the pair",
  },
  {
    name: "translation-nodes-accumulate-across-files-control",
    files: { en: ONE_KEY, fr: ONE_KEY },
    options: { maximumTranslationNodes: 2 },
    discriminates: "the control: the budget that fits both must load",
  },
  {
    name: "total-input-bytes-accumulate-across-files",
    payloads: { body: ONE_KEY },
    files: { en: "@payload:body", fr: "@payload:body" },
    options: { maximumTotalInputBytes: 12 },
    discriminates: "the same shape for the aggregate byte budget: 9 bytes each, so one fits and two do not",
  },
  {
    name: "per-file-input-bytes-do-not-accumulate",
    files: { en: ONE_KEY, fr: ONE_KEY },
    options: { maximumInputBytes: 9 },
    discriminates:
      "the OPPOSITE charge model, and the contrast is the point: `maximumInputBytes` is PER FILE, so two files at exactly the ceiling both load",
  },
  {
    name: "file-count-charges-only-parsed-files",
    files: { en: ONE_KEY, fr: ONE_KEY, "README.md": "junk", "notes.txt": "junk" },
    options: { maximumLocalizedStringsFiles: 2 },
    discriminates: "a port that decrements the file budget per directory ENTRY rather than per parsed file",
  },
  {
    name: "empty-object-file-loads-at-zero-nodes",
    files: { en: "{}" },
    options: { maximumTranslationNodes: 0 },
    discriminates: "a port that charges a constant 1 per file: the charge is the ROOT MEMBER COUNT, which can be zero",
  },

  // ---- warning streaming, and warning order WITHIN one file -----------------------------------
  {
    name: "warnings-stream-before-an-abort",
    files: { ru: INCOMPLETE_CARDINALITY },
    options: { maximumWarnings: 0 },
    discriminates:
      "a port that buffers warnings until success: at a budget of 0 the load refuses, and the refusal names the warning's own source",
  },
  {
    name: "two-warnings-in-one-file-keep-declaration-order",
    files: { ru: TWO_INCOMPLETE_PLACEHOLDERS },
    options: {},
    discriminates:
      "warning order WITHIN a file, which is JSON declaration order and therefore deterministic on both sides — unlike order ACROSS files, which no probe here asserts",
  },
  {
    name: "warning-budget-admits-then-refuses",
    files: { ru: TWO_INCOMPLETE_PLACEHOLDERS },
    options: { maximumWarnings: 1 },
    discriminates:
      "the budget compares BEFORE it increments, so the first warning is delivered and the second refuses the load — the delivered one must still be observable",
  },
  {
    name: "range-placeholder-is-not-warned-about",
    files: {
      ru: JSON.stringify({
        Items: {
          translation: "{{count}} {{noun}}",
          placeholders: { noun: { value: "count", range: { start: "start", end: "end" }, translations: { CARDINALITY_ONE: "item" } } },
        },
      }),
    },
    options: {},
    discriminates: "a port that warns on every incomplete placeholder: a range-driven one legitimately supplies a subset and is skipped",
  },

  // ---- blind spot 6: the path convention, which the corpus scrubs away -------------------------
  {
    name: "warning-source-is-the-resolved-path",
    files: { ru: INCOMPLETE_CARDINALITY },
    options: {},
    discriminates:
      "a port that reports the path AS GIVEN in a warning source. Both sides are handed the same directory and the message is compared VERBATIM, so the resolved/unresolved distinction the corpus scrubs to `<fixtures>/` is visible here",
  },
  {
    name: "per-file-failure-names-the-resolved-path",
    files: { en: "{ not json" },
    options: {},
    discriminates: "the same convention on the failure channel: a parse failure's message carries the resolved path plus line and column",
  },
  {
    name: "directory-level-failure-names-the-callers-spelling",
    files: { en: ONE_KEY, "README.md": "junk" },
    options: { maximumDiscoveryEntries: 1 },
    discriminates:
      "the OTHER path convention, and the pair is the point: a directory-level message uses the caller's spelling where a per-file one uses the resolved path",
  },

  // ---- the two duplicate rules, which are different rules with different messages --------------
  {
    name: "same-locale-two-spellings-collides-during-the-walk",
    files: { "en-US": ONE_KEY, "en-us.json": ONE_KEY },
    options: {},
    discriminates:
      "the walk-level duplicate rule, keyed on LOCALE IDENTITY rather than on the filename. Single-fault: exactly one collision, and the message names the canonical tag",
  },
  {
    name: "different-locales-rendering-one-tag-collide-after-the-walk",
    files: { "nn-NO": ONE_KEY, "no-NO-x-lvariant-NY": ONE_KEY },
    options: {},
    discriminates:
      "the POST-WALK rule, which is a different rule with a different message: these are two DIFFERENT locales that render to the same language tag",
  },
  {
    name: "lvariant-and-plain-spelling-are-the-same-locale",
    files: { "en-US-x-lvariant-POSIX": ONE_KEY, "en-US-POSIX.json": ONE_KEY },
    options: {},
    discriminates:
      "a port whose identity is the rendered tag rather than the Locale: these two spellings ARE one locale in Java, so they collide during the walk, not after it",
  },

  // ---- symlinked children and special files: behaviour NO corpus fixture can express, because
  // ---- `build.mjs` writes every fixture with a flat writeFileSync ---------------------------
  {
    name: "symlink-child-to-directory-is-skipped",
    files: { en: ONE_KEY, "zzz-bogus.json": "@->." },
    options: {},
    discriminates:
      "a port using dirent.isDirectory() from readdir(withFileTypes): a SYMLINK reports false there, so the entry would escape the directory skip and refuse the load. Java follows the link and skips it",
  },
  {
    name: "symlink-child-to-regular-file-loads",
    payloads: { body: ONE_KEY },
    files: { en: ONE_KEY, fr: "@payload:body" },
    options: {},
    discriminates:
      "the control for the pair: same shape, target is a regular file, so it LOADS — and its warning/failure source would be the TARGET's real path, not the link's",
  },
  {
    name: "dangling-symlink-with-a-valid-name",
    files: { en: ONE_KEY, fr: "@->./nowhere-at-all" },
    options: {},
    discriminates:
      "a port that silently skips an unresolvable entry: Java refuses with the UNRESOLVED constructed path, which is a third path convention distinct from both the resolved and the caller-spelling ones",
  },
  {
    name: "root-is-a-regular-file",
    root: "en",
    files: { en: ONE_KEY },
    options: {},
    discriminates: "a port that conflates a missing directory with a path that exists and is not one — two different messages",
  },
  {
    name: "root-does-not-exist",
    root: "no-such-child",
    files: { en: ONE_KEY },
    options: {},
    discriminates: "the other arm of that pair, and the control that proves the message above is about file TYPE rather than about absence",
  },
  {
    name: "root-symlink-to-directory-is-followed",
    root: "link",
    files: { link: "@->." },
    options: {},
    discriminates:
      "a port using lstat at the root: Java's exists/isDirectory FOLLOW links, so a symlinked directory argument is traversed rather than refused",
  },

  // ---- directory-level refusals ---------------------------------------------------------------
  {
    name: "empty-directory-loads-nothing-successfully",
    files: {},
    options: {},
    discriminates: "a port that treats an empty directory as an error: it is an ordinary success with an empty result",
  },
  {
    name: "every-entry-skipped-loads-nothing-successfully",
    files: { "README.md": "junk", ".hidden": "junk", nested: null },
    options: {},
    discriminates: "the stronger form of the above: entries exist, all are skipped, and the result is still an ordinary empty success",
  },
];
