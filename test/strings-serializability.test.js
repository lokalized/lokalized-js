// @ts-check
/**
 * **CLAUSE 73 — a `Strings` instance is not serializable; the PAYLOADS are what cross the boundary.**
 *
 * Plan 6.6:2356-2358: "Closures make a `Strings` instance non-serializable. RSC integrations send
 * raw/canonical catalog data or a manifest across the boundary and construct a client instance; they
 * do not attempt to serialize compiled closures."
 *
 * The normative half of that sentence is about a THIRD PARTY — no test here can go red because an
 * integration author called `JSON.stringify` on an instance, and this package ships no React entry
 * point. What is provable is the library-side precondition, in two halves: the instance has nothing
 * transferable to send and refuses loudly if you try, and every payload the library hands an
 * application to send instead survives the boundary and rebuilds an equivalent instance. Both halves
 * are here.
 *
 * **WHY THE OBVIOUS PROBES ARE ALL BLIND, each measured rather than argued:**
 *
 *   - `assert.throws(() => structuredClone(strings))` — the single assertion a reader reaches for
 *     first — cannot fail over either leak an implementer actually writes. ONE surviving closure is
 *     enough to make the clone throw, so an instance that also carried a convenience `fallbackLocale`
 *     data property, or a `toJSON()` so it "serializes nicely", throws exactly the same way. The
 *     defect that matters is not "a Strings became cloneable", it is "a Strings started leaking a
 *     PARTIAL": an RSC serializer ships `{"fallbackLocale":"en"}` across and the client receives a
 *     plausible object with no `get`. Hence `nonFunctionOwnKeys` AND `JSON.stringify` — they have
 *     complementary blind spots (the key audit is blind to `toJSON`, which is itself a function).
 *   - `JSON.parse(JSON.stringify(payload))` byte-identity is blind to a stray closure riding a wire
 *     payload in BOTH forms, because `stringify` drops the function on each side of the round trip
 *     and the two texts still match. `structuredClone` catches only the ENUMERABLE form — and a
 *     memoization cache is non-enumerable, which is why the `Reflect.ownKeys` walk in `auditPayload`
 *     is not belt-and-braces over a JSON check but the only instrument here that sees the defect the
 *     clause names. The K3 test measures all three instruments on one dirty payload so the claim is
 *     executable rather than written down.
 *   - `assert.deepStrictEqual(JSON.parse(JSON.stringify(payload)), payload)` is a FALSE RED: the
 *     loader builds null-prototype records (plan 4.3) and `deepEqual` here compares prototypes.
 *     Structure is compared as canonical JSON TEXT; contents are compared by walking own keys.
 *
 * **FOUR COPIES, NOT ONE, and the fourth is a genuine realm.** Plan 2.4:1268 — "recognition is
 * structural so values survive JSON, RSC, workers, structured clone, and cross-realm boundaries" —
 * names the boundaries, and they have DIFFERENT blind spots: `structuredClone` preserves a `Map`
 * where JSON destroys it (the S11b defect, one module over), and neither produces a foreign-realm
 * object, so neither would notice an `instanceof`/prototype check added to a construction door.
 * Plan 3.4:712-716 forbids exactly that: "correctness never depends on `instanceof`, a private
 * `WeakSet`, or module-singleton identity."
 *
 * NOT PROVEN HERE, deliberately. The published TYPE surface does not admit the clause's own
 * prescribed call: `types/core/index.d.ts` emits `CreateStringsOptions` as ONE object type with
 * `fallbackLocale` and `strings` REQUIRED and no `loaded` member at all, where plan 3.2:566-587
 * declares a two-member discriminated union — so `createStrings({ loaded, locale })`, which every
 * test below runs successfully, does not type-check. That gap needs a `.ts` fixture compiled by a
 * project of its own (`npm run check` is `tsc --noEmit` over `include: ["src/**\/*.js"]`, which
 * cannot see a file under `test/`), so it is reported rather than half-written here.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runInNewContext } from "node:vm";

import { createStrings } from "../src/core/index.js";
import { catalogIdentityBytes, catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity, parseStringsManifest, validateStringsManifest } from "../src/load/index.js";
import {
  createStringsManifestFromDirectory,
  loadEntireManifestFromFiles,
  loadStringsFromDirectory,
} from "../src/node/index.js";
import { parseStrings } from "../src/parse/index.js";

// ---------------------------------------------------------------------------------------------
// The fixture, and why it is this one
// ---------------------------------------------------------------------------------------------

/**
 * Two CLDR-equivalent tags for one language, so a TIEBREAKER decides which catalog answers.
 *
 * A constants-only fixture is green over a payload that lost its tiebreakers whenever the language
 * has a single catalog — "the corpus is blind to tiebreakers" wearing this clause's hat. Covering the
 * round trip is not discriminating what the round trip carries, so each probe key is decided by a
 * DIFFERENT part of the payload:
 *
 *   - `k` is decided by `tiebreakers` — `FROM-SU` under `[hy-SU, hy-AM]`, `FROM-AM` flipped;
 *   - `items` is decided by the catalog's `placeholders` sub-record and a compiled alternative
 *     expression — `one-SU` at `n: 1`, `many-SU` otherwise.
 *
 * They are separable, measured: an ablation that hands the wire projection the parser's internal
 * `placeholders` Map instead of projecting it leaves `k` GREEN in all four copies and reds `items`
 * in the JSON and cross-realm copies ONLY (they answer `items`, the key echoed back). Without a key
 * of the second kind a Map-shaped payload field could be lost with every assertion still passing.
 *
 * @param {"AM" | "SU"} mark
 */
const catalogText = (mark) => JSON.stringify({
  k: `FROM-${mark}`,
  items: {
    translation: "{{amount}}",
    placeholders: { amount: { translation: `many-${mark}`, alternatives: [{ "n == 1": `one-${mark}` }] } },
  },
});

/** The tiebreaker order that makes `hy-SU` supply, which every non-control assertion below expects. */
const OPTIONS = Object.freeze({
  catalogVersion: "v1",
  fallbackLocale: "hy-AM",
  tiebreakers: { hy: ["hy-SU", "hy-AM"] },
});

/**
 * The identity pin, and the fixture digests that guard it.
 *
 * PINNED RATHER THAN SELF-COMPARED. A copy-versus-original comparison stays GREEN over a defect that
 * degrades BOTH operands — measured on exactly this subject: with `tiebreakers` dropped from the
 * identity projection the generator and every copy agree perfectly and the fingerprint is simply a
 * different number. That is the S11b shape ("fingerprinted byte-identically to declaring none")
 * reappearing inside the test written to catch it, so the expected value is written down.
 *
 * All three are machine-independent: the canonical projection excludes `baseUrl`, per-file `url` and
 * `decodedBytes`, so nothing about the temporary directory reaches them. `CATALOG_SHA256` is the pin's
 * own guard — edit `catalogText` and it reds by name ("the fixture moved") instead of the fingerprint
 * reding as an unexplained number.
 */
const CATALOG_SHA256 = Object.freeze({
  "hy-AM": "7d849d71b62028f8aeecffffd0f2629e63286474775dcf8e7fd01f446d7d003d",
  "hy-SU": "1734d48fe8e021513d00d073ef307f1ef737ffa6f7394b5a1be9dc40c5d691e9",
});
const PINNED_FINGERPRINT = "1de8911458cf18c414f850d7442143064d1dd3795468eabe0bbd12d1293225db";
const PINNED_IDENTITY_BYTES =
  '{"catalogVersion":"v1","formatVersion":1,"localeToSha256":' +
  `{"hy-AM":"${CATALOG_SHA256["hy-AM"]}","hy-SU":"${CATALOG_SHA256["hy-SU"]}"},` +
  '"resolvedFallbackLocale":"hy-AM","tiebreakers":{"hy":["hy-SU","hy-AM"]}}';

/** The twelve members plan 3.3 puts on an instance. A NAMED SET, not a count — see the K1 test. */
const INSTANCE_MEMBERS = Object.freeze([
  "get", "t", "getResult", "getSupportedLocales", "getKeysForLocale", "getMissingKeys",
  "getLocaleConfiguration", "getCatalogIdentity", "isCatalogComplete", "getLoadVerification",
  "getWarnings", "getDirectLocaleContext",
]);

// Every fixture lives under ONE directory, removed when this file's tests finish. Until 2026-09-23
// each fixture was its own directory in the system temp folder and nothing removed it: 4,188
// `lokalized-clause73-*` directories were counted there, seven per run.
const scratch = mkdtempSync(join(tmpdir(), "lokalized-clause73-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** @param {{ omit?: "hy-SU" }} [shape] */
function fixtureDirectory(shape = {}) {
  const directory = mkdtempSync(join(scratch, "d-"));
  writeFileSync(join(directory, "hy-AM.json"), catalogText("AM"));
  if (shape.omit !== "hy-SU") writeFileSync(join(directory, "hy-SU.json"), catalogText("SU"));
  return directory;
}

// ---------------------------------------------------------------------------------------------
// Boundary copies
// ---------------------------------------------------------------------------------------------

/**
 * The four boundaries, as four copies of one value.
 *
 * The `vm` copy is the only one built in a FOREIGN REALM, and the test that uses it asserts that
 * topology first: without the prototype check it is a third JSON copy wearing a different name, and
 * the prohibition it exists to gate (plan 3.4:712-716) would go unobserved.
 *
 * @template T @param {T} value @returns {Record<string, T>}
 */
const boundaryCopies = (value) => ({
  "in-realm": value,
  json: JSON.parse(JSON.stringify(value)),
  "structured-clone": structuredClone(value),
  "cross-realm": runInNewContext(`(${JSON.stringify(value)})`),
});

/** Canonical JSON TEXT — the structural comparison this boundary permits. See the module header. */
const wire = (/** @type {unknown} */ value) => JSON.stringify(value);

// ---------------------------------------------------------------------------------------------
// The payload audit
// ---------------------------------------------------------------------------------------------

/**
 * Walk an object graph by `Reflect.ownKeys` + `getOwnPropertyDescriptor`, reporting BY PATH.
 *
 * Deliberately not `Object.keys` (blind to non-enumerable) and not `JSON.stringify` (blind to
 * functions in both forms). `length` is skipped on arrays only: it is an own non-enumerable data
 * property of every array and says nothing about the payload.
 *
 * @param {unknown} root @param {string} label
 */
function auditPayload(root, label) {
  /** @type {string[]} */ const functions = [];
  /** @type {string[]} */ const accessors = [];
  /** @type {string[]} */ const symbols = [];
  /** @type {string[]} */ const exotic = [];
  /** @type {string[]} */ const mutable = [];
  /** @type {Set<string>} */ const leaves = new Set();
  const seen = new Set();

  const visit = (/** @type {unknown} */ node, /** @type {string} */ path) => {
    if (typeof node === "function") { functions.push(path); return; }
    if (node === null || typeof node !== "object") { leaves.add(path); return; }
    if (seen.has(node)) return;
    seen.add(node);

    const prototype = Object.getPrototypeOf(node);
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
      exotic.push(`${path} <${prototype?.constructor?.name ?? "unknown"}>`);
    // A third party cannot memoize onto a frozen node, so the freeze is part of what makes the
    // payload boundary-safe rather than merely clean today. Nothing else here records it.
    if (!Object.isFrozen(node)) mutable.push(path);

    for (const key of Reflect.ownKeys(node)) {
      if (typeof key === "symbol") { symbols.push(`${path}[${String(key)}]`); continue; }
      if (Array.isArray(node) && key === "length") continue;
      const descriptor = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(node, key));
      if (!("value" in descriptor)) { accessors.push(`${path}.${key}`); continue; }
      visit(descriptor.value, `${path}.${key}`);
    }
  };

  visit(root, label);
  return { functions, accessors, symbols, exotic, mutable, leaves };
}

/**
 * A deep copy that PRESERVES prototypes and is not frozen — the instrument control's subject.
 *
 * `structuredClone` is not usable for this: it does not preserve null prototypes (measured), and the
 * payload has several null-prototype records, so a clone-based control would walk a structurally
 * different object than the one under test and prove nothing about the walk that ran.
 *
 * @param {any} node @returns {any}
 */
function mutableDeepCopy(node) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(mutableDeepCopy);
  const copy = Object.create(Object.getPrototypeOf(node));
  for (const key of Reflect.ownKeys(node)) copy[key] = mutableDeepCopy(node[key]);
  return copy;
}

// ---------------------------------------------------------------------------------------------
// K1 — the instance has no transferable state
// ---------------------------------------------------------------------------------------------

test("K1 a Strings instance carries no transferable state, through BOTH construction doors", async () => {
  const direct = createStrings({
    fallbackLocale: "en", locale: "en", strings: { en: [{ key: "hello", translation: "Hello" }] },
  });
  const loaded = await loadStringsFromDirectory(fixtureDirectory(), OPTIONS);
  const fromLoader = createStrings({ loaded, locale: "hy" });

  // **THE CONTROL RUNS FIRST, and it is the load-bearing half.** `Reflect.ownKeys({})` is `[]` and
  // `JSON.stringify({})` is `"{}"` — the two headline assertions below are exactly the ones a DEAD
  // object passes best, so each instance must answer a real translation end to end before its shape
  // is inspected at all. Without this, `strings = {}` is a perfect score.
  assert.equal(direct.get("hello"), "Hello", "the direct instance must answer before its shape is judged");
  assert.equal(fromLoader.get("k"), "FROM-SU", "the loaded instance must answer before its shape is judged");

  // BOTH DOORS, because the clause says "a `Strings` instance" and an RSC client holds the LOADED
  // one — the branch that carries a verification record and is likeliest to grow a wrapper around it.
  for (const [door, strings] of [["direct", direct], ["loaded", fromLoader]]) {
    const instance = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (strings));
    const ownKeys = Reflect.ownKeys(instance);

    // A NAMED SET, not `ownKeys.length >= 12`. A bare integer floor is satisfied by an instance that
    // dropped `get` and gained thirteen others, and it carries no binding to WHICH members these are.
    // This is also the only assertion in the file that catches members moving onto a prototype, where
    // the two below both stay green: `Reflect.ownKeys` of such an instance is `[]`, so the
    // "no non-function own keys" filter passes vacuously and `JSON.stringify` is still `"{}"`.
    assert.deepEqual(
      INSTANCE_MEMBERS.filter((member) => !Object.prototype.hasOwnProperty.call(instance, member)), [],
      `${door}: members left the instance — moved onto a prototype, or renamed`,
    );

    // Every own key is a CLOSURE. A convenience data property here is the leak that matters: an RSC
    // serializer ships it and the client gets a plausible object with no `get`.
    assert.deepEqual(
      ownKeys.filter((key) => typeof instance[/** @type {string} */ (key)] !== "function").map(String), [],
      `${door}: an own key that is not a function is transferable state`,
    );

    // And the complement, which the audit above cannot see: `toJSON` is itself a function, so an
    // instance taught to "serialize nicely" passes the filter and fails here.
    assert.equal(wire(instance), "{}", `${door}: an instance must serialize to nothing at all`);
  }
});

// ---------------------------------------------------------------------------------------------
// K2 — the refusal is loud
// ---------------------------------------------------------------------------------------------

test("K2 structuredClone REFUSES a Strings instance, by name, and the instrument is proved first", async () => {
  const loaded = await loadStringsFromDirectory(fixtureDirectory(), OPTIONS);

  // **THE zh-123 GUARD, unconditional and local.** `assert.throws(() => structuredClone(x))` is
  // satisfied by a `ReferenceError` in a runtime that has no `structuredClone` at all, so the
  // instrument is proved before it is trusted — and proved to produce a REAL COPY rather than
  // returning its argument, which a stub would.
  assert.doesNotThrow(() => structuredClone(loaded), "structuredClone must work on a clean payload");
  const clonedPayload = structuredClone(loaded);
  assert.equal(clonedPayload.fallbackLocale, "hy-AM");
  assert.notEqual(clonedPayload, loaded, "a stub returning its argument would pass every row below");

  const strings = createStrings({ loaded, locale: "hy" });
  // The second control: a failed construction must not be able to masquerade as a refusal.
  assert.equal(strings.get("k"), "FROM-SU");

  // NOT `const err = assert.throws(...)`: `node:assert`'s `throws` returns undefined, so that form
  // TypeErrors on every run, green or red — and gets "fixed" by deleting the name assertion, leaving
  // the bare `assert.throws` the module header calls blind. The name IS the pass condition here.
  let caught;
  try {
    structuredClone(strings);
  } catch (error) {
    caught = /** @type {Error} */ (error);
  }
  assert.ok(caught, "structuredClone did not refuse a Strings instance — it produced a dead copy");
  assert.equal(caught.name, "DataCloneError", `refused with ${caught.name}: ${caught.message}`);
  assert.equal(caught.constructor.name, "DOMException");
});

// ---------------------------------------------------------------------------------------------
// K3 — nothing on the wire is a closure
// ---------------------------------------------------------------------------------------------

test("K3 every payload the clause names is function-free, plain and frozen, reported BY PATH", async () => {
  const directory = fixtureDirectory();
  const parsed = parseStrings(catalogText("SU"), { locale: "hy-SU", source: "hy-SU.json" });
  const loaded = await loadStringsFromDirectory(directory, OPTIONS);
  const manifest = await createStringsManifestFromDirectory(directory, {
    ...OPTIONS, publicationBaseUrl: "https://cdn.example/i18n/",
  });

  // CONTROL: each payload must be a LIVE one. A payload that failed to build is trivially clean.
  assert.equal(
    createStrings({
      fallbackLocale: "hy-AM", locale: "hy", tiebreakers: OPTIONS.tiebreakers,
      strings: { "hy-AM": parseStrings(catalogText("AM"), { locale: "hy-AM" }), "hy-SU": parsed },
    }).get("k"), "FROM-SU", "the ParsedStringsFile pair must build a working instance");
  assert.equal(createStrings({ loaded, locale: "hy" }).get("k"), "FROM-SU");
  assert.deepEqual(Object.keys(validateStringsManifest(manifest).files), ["hy-AM", "hy-SU"]);

  /**
   * NAMED PATHS, one per structurally distinct region, rather than a visited-node COUNT. A count is
   * unmoored from the fixture — it is a constant nothing re-derives, so it either rots into an
   * arithmetic coincidence or false-reds the day the fixture changes — and "node" has three readings
   * (objects only, leaves too, arrays or not) that give three different numbers. A recursion that
   * silently stops descending fails here BY NAME.
   */
  const audits = [
    [parsed, "parsed", [
      "parsed.$lokalized",
      "parsed.strings.1.placeholders.amount.alternatives.0.translation",
      "parsed.originsByKey.items.0",
    ]],
    [loaded, "loaded", [
      "loaded.catalogs.hy-AM.strings.0.translation",
      "loaded.catalogs.hy-SU.strings.1.placeholders.amount.alternatives.0.expression",
      "loaded.catalogs.hy-SU.originsByKey.items.0",
      "loaded.tiebreakers.hy.0",
      "loaded.manifestLocaleConfiguration.tiebreakers.hy.0",
      "loaded.catalogIdentity.catalogFingerprint",
      "loaded.loadingLimits.maximumWarnings",
      "loaded.requestedFiles.0.url",
      "loaded.coverage.kind",
    ]],
    [manifest, "manifest", [
      "manifest.baseUrl", "manifest.files.hy-SU.sha256", "manifest.tiebreakers.hy.1",
    ]],
  ];

  for (const [payload, label, requiredLeaves] of /** @type {any[][]} */ (audits)) {
    const audit = auditPayload(payload, label);
    assert.deepEqual(audit.functions, [], `${label}: a function value cannot cross the boundary`);
    assert.deepEqual(audit.accessors, [], `${label}: an accessor is a closure in disguise`);
    assert.deepEqual(audit.symbols, [], `${label}: a symbol key does not survive any boundary`);
    assert.deepEqual(audit.exotic, [], `${label}: a Map/Set/Date/class instance is not a wire value`);
    assert.deepEqual(audit.mutable, [], `${label}: an unfrozen node can be memoized onto in place`);
    assert.deepEqual(
      requiredLeaves.filter((/** @type {string} */ leaf) => !audit.leaves.has(leaf)), [],
      `${label}: the walk never reached these leaves, so its clean report means nothing`,
    );
  }

  // ---- THE INSTRUMENT CONTROL, and the measurement behind the module header ------------------
  //
  // One node of a same-shaped, prototype-preserving deep copy gets a NON-ENUMERABLE closure — the
  // form a memoized compiled predicate actually takes. All three candidate instruments are run on it.
  const dirty = mutableDeepCopy(loaded);
  Object.defineProperty(dirty.catalogs["hy-SU"].strings[1], "compiled", {
    value: () => true, enumerable: false,
  });

  assert.ok(
    auditPayload(dirty, "loaded").functions.includes("loaded.catalogs.hy-SU.strings.1.compiled"),
    "the walk did not find a planted closure, so its clean reports above prove nothing",
  );
  // BLIND INSTRUMENT 1: JSON text is byte-identical, because `stringify` drops the function on both
  // sides. BLIND INSTRUMENT 2: structuredClone does not refuse it, because the property is not
  // enumerable — it silently drops it. Neither could gate this clause.
  assert.equal(wire(dirty), wire(loaded), "JSON byte-identity is blind to a planted closure");
  assert.doesNotThrow(() => structuredClone(dirty), "structuredClone is blind to a NON-enumerable one");
});

// ---------------------------------------------------------------------------------------------
// K4 — a LoadedStrings rebuilds an equivalent client instance
// ---------------------------------------------------------------------------------------------

test("K4 a LoadedStrings crosses four boundaries and rebuilds an observationally identical instance", async () => {
  const loaded = await loadStringsFromDirectory(fixtureDirectory(), OPTIONS);
  const copies = boundaryCopies(loaded);

  // TOPOLOGY FIRST. Without this the cross-realm row is a third JSON copy and the prohibition it
  // exists to gate — plan 3.4:712-716's "never depends on `instanceof` … or module-singleton
  // identity" — is unobserved, because JSON and structuredClone both yield THIS realm's prototype.
  assert.notEqual(Object.getPrototypeOf(copies["cross-realm"]), Object.prototype,
    "the vm copy shares this realm's Object.prototype, so it tests nothing JSON does not");
  assert.equal(Object.getPrototypeOf(copies.json), Object.prototype);

  // The SERVER's instance. Every copy is compared against IT, not only against literals: a defect
  // that moves server and client together satisfies a literal-only row (measured on the manifest
  // identity one conjunct over, where exactly that happens).
  const reference = createStrings({ loaded, locale: "hy" });

  // …and the literals are kept as a SEPARATE discrimination assertion, so the pair cannot drift
  // together. `assert.equal(get("k"), "FROM-SU")` alone is a test that one catalog exists; the
  // flipped-tiebreaker control below is what makes it a test that the tiebreaker survived.
  assert.equal(reference.get("k"), "FROM-SU");
  assert.equal(reference.get("items", { n: 1 }), "one-SU");
  assert.equal(reference.get("items", { n: 3 }), "many-SU");
  assert.deepEqual(reference.getSupportedLocales(), ["hy-AM", "hy-SU"]);
  // Asserted BY NAME before any field of it is touched — never `if (verification?.complete)`.
  assert.notEqual(reference.getLoadVerification(), null, "the reference instance carries no record");

  for (const [name, copy] of Object.entries(copies)) {
    const client = createStrings({ loaded: copy, locale: "hy" });
    for (const [key, argument] of [["k", undefined], ["items", { n: 1 }], ["items", { n: 3 }]]) {
      assert.equal(client.get(/** @type {string} */ (key), /** @type {any} */ (argument)),
        reference.get(/** @type {string} */ (key), /** @type {any} */ (argument)),
        `${name}: '${key}' answers differently from the server instance`);
    }
    assert.equal(wire(client.getSupportedLocales()), wire(reference.getSupportedLocales()), name);
    assert.equal(wire(client.getLocaleConfiguration()), wire(reference.getLocaleConfiguration()), name);
    // The identity is what the manifest half of the clause exists to carry across at all.
    assert.equal(wire(client.getCatalogIdentity()), wire(reference.getCatalogIdentity()), name);
    assert.equal(client.isCatalogComplete(), true, name);
    assert.notEqual(client.getLoadVerification(), null, `${name}: no verification record survived`);
  }

  // **THE DISCRIMINATION CONTROL.** Same fixture, tiebreakers flipped: every copy must answer
  // `FROM-AM`. Without it the loop above passes over a payload whose tiebreakers were destroyed —
  // the language would simply resolve to whatever catalog came first.
  const flipped = await loadStringsFromDirectory(fixtureDirectory(), {
    ...OPTIONS, tiebreakers: { hy: ["hy-AM", "hy-SU"] },
  });
  for (const [name, copy] of Object.entries(boundaryCopies(flipped))) {
    const client = createStrings({ loaded: copy, locale: "hy" });
    assert.equal(client.get("k"), "FROM-AM", `${name}: the flipped tiebreaker did not survive`);
    assert.equal(client.get("items", { n: 1 }), "one-AM", `${name}: the flipped tiebreaker did not survive`);
  }
});

test("K4b a PARTIAL LoadedStrings crosses too, and its diagnostic cause is MEASURED, not claimed", async () => {
  // The complete record's `failures` and `warnings` are EMPTY, so every JSON-hostile field of a
  // `LoadedStrings` is structurally absent from the test above — "the round trip was covered" is not
  // "what the round trip carries was discriminated", applied to the payload's own field set. A
  // partial record is where those fields exist, and it costs three lines to build.
  const directory = fixtureDirectory();
  const manifest = await createStringsManifestFromDirectory(directory, OPTIONS);
  rmSync(join(directory, "hy-SU.json"));
  const partial = await loadEntireManifestFromFiles(manifest, { partialFailure: "allow-partial" });

  // Asserted by name first: if the load were complete, every row below would be vacuous.
  assert.equal(partial.complete, false, "the fixture must actually produce a partial result");
  assert.equal(partial.failures.length, 1);
  assert.ok(partial.failures[0].cause instanceof Error, "the cause must be a real Error to be at risk");

  const reference = createStrings({ loaded: partial, locale: "hy" });
  assert.equal(reference.get("k"), "FROM-AM", "with hy-SU missing the surviving catalog answers");
  for (const [name, copy] of Object.entries(boundaryCopies(partial))) {
    const client = createStrings({ loaded: copy, locale: "hy" });
    assert.equal(client.get("k"), reference.get("k"), name);
    assert.equal(client.isCatalogComplete(), false, `${name}: a partial load must stay partial`);
    // The SELECTION channel still reports the full manifest; the loaded set is the smaller one.
    assert.deepEqual(client.getSupportedLocales(), ["hy-AM"], name);
    assert.deepEqual(client.getLocaleConfiguration().supportedLocales, ["hy-AM", "hy-SU"], name);
  }

  // **WHAT IS NOT COMPARED, SAID OUT LOUD so a later reader cannot mistake silence for parity.**
  // `LoadFailure.cause` is typed `unknown` and here holds an `Error`. Measured: JSON keeps only the
  // enumerable own fields (`errno`/`code`/`syscall`/`path`) and loses the message and the prototype,
  // while structuredClone preserves the Error. So a partial record does NOT round-trip faithfully in
  // its diagnostic fields — which contradicts nothing, because plan 6.2 says a partial result makes
  // no server/client parity claim, and the clause names only catalog data and manifests. It is
  // asserted here so the asymmetry is a recorded measurement rather than an untested belief.
  const jsonCause = /** @type {any} */ (JSON.parse(JSON.stringify(partial))).failures[0].cause;
  assert.equal(jsonCause instanceof Error, false, "if JSON now preserved Errors this note is stale");
  assert.equal(jsonCause.message, undefined, "JSON loses the message; nothing above depends on it");
  assert.ok(structuredClone(partial).failures[0].cause instanceof Error,
    "structuredClone preserves it; the two boundaries genuinely differ here");
});

// ---------------------------------------------------------------------------------------------
// K5 — the manifest keeps a pinned identity, and still loads
// ---------------------------------------------------------------------------------------------

test("K5 a StringsManifestV1 keeps a PINNED identity across five copies, and rebuilds a client instance", async () => {
  const directory = fixtureDirectory();
  const published = await createStringsManifestFromDirectory(directory, {
    ...OPTIONS, publicationBaseUrl: "https://cdn.example/i18n/",
  });

  // THE PIN'S OWN GUARD. Edit `catalogText` and this reds by name — "the fixture moved, the pin is
  // stale" — instead of the fingerprint reding as an unexplained hex number.
  assert.deepEqual({ ...Object.fromEntries(Object.entries(published.files).map(([tag, file]) => [tag, file.sha256])) },
    { ...CATALOG_SHA256 }, "the fixture's bytes changed; the identity pin below is stale");

  const decoder = new TextDecoder();
  const bytesOf = (/** @type {any} */ m) => decoder.decode(catalogIdentityBytes(catalogIdentityInputFor(m)));

  // THE IN-REALM ROW IS COMPARED TO THE LITERAL FIRST. A defect that degrades both operands of a
  // copy-versus-original comparison leaves every boundary row green — measured on this exact subject.
  assert.equal(bytesOf(published), PINNED_IDENTITY_BYTES, "the canonical identity bytes moved");
  assert.equal(published.catalogFingerprint, PINNED_FINGERPRINT);

  const copies = {
    ...boundaryCopies(published),
    "re-parsed": parseStringsManifest(JSON.stringify(published)),
  };
  assert.notEqual(Object.getPrototypeOf(copies["cross-realm"]), Object.prototype);

  for (const [name, copy] of Object.entries(copies)) {
    assert.doesNotThrow(() => validateStringsManifest(copy), `${name}: the copy no longer validates`);
    // The PUBLIC channel — the comparison an integration can actually make.
    assert.equal(computeCatalogIdentity(catalogIdentityInputFor(copy)).catalogFingerprint,
      PINNED_FINGERPRINT, `${name}: the fingerprint moved across the boundary`);
    // …and the BYTES, which say WHICH field moved rather than only that one did.
    assert.equal(bytesOf(copy), PINNED_IDENTITY_BYTES, `${name}: the canonical identity bytes moved`);
  }

  // INSTRUMENT CONTROL: the byte comparison must be able to move at all. Without it a
  // `catalogIdentityBytes` that returned a constant passes every row above.
  const perturbed = JSON.parse(JSON.stringify(published));
  perturbed.files["hy-SU"].sha256 = `${"0".repeat(63)}1`;
  assert.notEqual(bytesOf(perturbed), PINNED_IDENTITY_BYTES, "perturbing a catalog digest moved nothing");

  // **THE CLAUSE'S SECOND HALF: "and construct a client instance."** A manifest that survives
  // byte-identically and then cannot be loaded from satisfies every row above. This one is generated
  // against the directory's own `file:` URL, crossed as JSON, and loaded from the other side.
  const local = await createStringsManifestFromDirectory(directory, OPTIONS);
  assert.equal(local.catalogFingerprint, PINNED_FINGERPRINT,
    "identity excludes baseUrl, so the local and published manifests are the same catalogs");
  const crossed = JSON.parse(JSON.stringify(local));
  const client = createStrings({ loaded: await loadEntireManifestFromFiles(crossed), locale: "hy" });
  assert.equal(client.get("k"), "FROM-SU");
  assert.equal(client.get("items", { n: 1 }), "one-SU");
  assert.equal(client.getCatalogIdentity()?.catalogFingerprint, PINNED_FINGERPRINT);
});

// ---------------------------------------------------------------------------------------------
// K7 — raw/canonical catalog data, the payload the clause names FIRST
// ---------------------------------------------------------------------------------------------

test("K7 raw and canonical catalog data cross the boundary and construct a client instance", async () => {
  // The clause's FIRST named payload — "RSC integrations send raw/canonical catalog data … and
  // construct a client instance" — and the only row that would notice if structural recognition of a
  // boundary-crossed `$lokalized: "parsed-strings-file"` marker were replaced by an `instanceof`, a
  // prototype check or a `WeakSet`, which plan 3.4:712-716 forbids by name. The loaded door cannot
  // see that alone: its catalogs travel inside a `LoadedStrings`, whose own validation would be what
  // failed, and a reader would read the diagnosis off the wrong door.
  const canonical = {
    "hy-AM": parseStrings(catalogText("AM"), { locale: "hy-AM", source: "hy-AM.json" }),
    "hy-SU": parseStrings(catalogText("SU"), { locale: "hy-SU", source: "hy-SU.json" }),
  };
  /** @param {Record<string, unknown>} strings */
  const clientFor = (strings, tiebreakers = OPTIONS.tiebreakers) => createStrings({
    fallbackLocale: "hy-AM", locale: "hy", tiebreakers, strings,
  });

  const reference = clientFor(canonical);
  assert.equal(reference.get("k"), "FROM-SU");
  assert.equal(reference.get("items", { n: 1 }), "one-SU");
  // A direct instance carries no load verification, by plan 3.3 — asserted so a later reader does
  // not take this door for the loaded one.
  assert.equal(reference.getLoadVerification(), null);

  for (const [name, copy] of Object.entries(boundaryCopies(canonical))) {
    if (name === "cross-realm")
      assert.notEqual(Object.getPrototypeOf(copy["hy-SU"]), Object.prototype,
        "the vm catalogs share this realm's prototype, so the structural-recognition row is vacuous");
    const client = clientFor(copy);
    assert.equal(client.get("k"), reference.get("k"), `${name}: canonical catalog data`);
    assert.equal(client.get("items", { n: 1 }), reference.get("items", { n: 1 }), `${name}: canonical`);
    assert.deepEqual(client.getSupportedLocales(), ["hy-AM", "hy-SU"], name);
  }

  // RAW catalog data — the other half of "raw/canonical", and the form that crosses as plain text or
  // bytes with no library type at all.
  assert.equal(clientFor({ "hy-AM": catalogText("AM"), "hy-SU": catalogText("SU") }).get("k"), "FROM-SU");
  const utf8 = new TextEncoder();
  assert.equal(
    clientFor({ "hy-AM": utf8.encode(catalogText("AM")), "hy-SU": utf8.encode(catalogText("SU")) })
      .get("items", { n: 1 }), "one-SU");

  // THE DISCRIMINATION CONTROL for this door, same shape as K4's: a flipped tiebreaker must move the
  // answer, or the rows above are a test that two catalogs exist.
  assert.equal(clientFor(canonical, { hy: ["hy-AM", "hy-SU"] }).get("k"), "FROM-AM");
  assert.equal(
    clientFor(JSON.parse(JSON.stringify(canonical)), { hy: ["hy-AM", "hy-SU"] }).get("items", { n: 1 }),
    "one-AM");
});
