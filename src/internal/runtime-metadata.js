// @ts-check
/**
 * The rendering core's own pinned identity — plan sections 5.1 and 7's compatibility metadata.
 *
 * WHY THESE ARE CONSTANTS IN SOURCE rather than read from a file. `src/` may not touch a Node
 * built-in, and these values must be available to a browser graph, so there is nowhere to read them
 * FROM at runtime. The cost of a constant is that it can drift from the artifacts it claims to
 * describe, so every field below is gated by `test/runtime-metadata.test.js`, which reads
 * `package.json` and the two `lokalized-spec` locks and requires exact equality. A constant with a
 * test behind it is a pin; a constant without one is a guess that looks like a fact.
 *
 * WHY CORE HOLDS THEM AT ALL, which is the load-bearing part for `lokalized/ssr`. Plan 6.4 requires
 * the SSR stamp's producer/data/mode fields to come "from that verified record, never from the SSR
 * module's own constants", precisely so an SSR helper loaded from a DIFFERENT installed copy
 * describes the rendering instance rather than itself. That only works if the renderer is the one
 * holding the identity — so these live here, travel out through `getLoadVerification()`, and
 * `src/ssr/index.js` declares no constant of its own.
 *
 * `ianaRegistryDate` DIVERGED FROM THE PLAN FOR A WHILE and no longer does — see its docblock.
 */

/**
 * @typedef {object} RuntimeMetadata
 * @property {"lokalized-js"} producerImplementation
 * @property {string} producerVersion
 * @property {string} behavioralVectorsVersion
 * @property {"pinned"} localeDataMode
 * @property {"exact"} cardinalityMode
 * @property {string} ianaRegistryDate
 * @property {string} ianaDataFingerprint
 */

/** @type {Readonly<RuntimeMetadata>} */
export const RUNTIME_METADATA = Object.freeze({
  // Plan 6.4 fixes the literal: strict v1 validation "requires both sides to report
  // `producerImplementation: "lokalized-js"`". It is NOT the npm package name (`lokalized`), which
  // names the package rather than the implementation.
  producerImplementation: /** @type {const} */ ("lokalized-js"),

  // `package.json`'s version, compared EXACTLY by strict v1 hydration (plan 6.4). A release that
  // bumps the package and forgets this line would make every stamp claim the old build; the test
  // reads `package.json` so that cannot happen quietly.
  producerVersion: "1.0.0-rc.1",

  // `lokalized-spec generated/behavioral-vectors.json`'s own `behavioralVectorsVersion`. 1.1.0 since
  // amendment A30: plan :2619 says a Java semantic change updates the vectors and this version in the
  // same change, and A30 moved two recorded answers (`iana-equivalence.registry-gap.{mgp,yol}-ranges`).
  behavioralVectorsVersion: "1.1.0",

  // Plan 5.1 declares both as root metadata for THIS build: the port classifies from pinned CLDR
  // data and its selectors are the exact digit-string/BigInt interpreter, never `Intl`. They are
  // literal types rather than `string` because plan 6.4's strict hydration rule discriminates on
  // them, and a widened type would let a future host-`Intl` build satisfy this one's declaration.
  localeDataMode: /** @type {const} */ ("pinned"),
  cardinalityMode: /** @type {const} */ ("exact"),

  /**
   * The `File-Date` of the pinned IANA Language Subtag Registry snapshot — plan 5.1's definition,
   * and since amendment A30 the whole of the data's provenance rather than a label beside it.
   *
   * **THE DATA IS GENERATED FROM THAT SNAPSHOT, WITH NO JDK.** lokalized-spec's
   * `tools/iana-oracle/generate.mjs` reads `tools/iana-oracle/language-subtag-registry.txt`
   * (`File-Date: 2026-09-17`, 9,296 records, sha256 `755fad43…`) plus ONE authored input — the order of
   * the fourteen region/variant substitutions, `tools/iana-oracle/jdk-compatibility.json` — and emits
   * `generated/iana-language-equivalences.json`, which `tools/gen-iana-data.js` encodes into
   * `src/data/iana-{range,identity}-equivalents.js`. The JDK and lokalized-java are CHECKS on that
   * output (`npm run check:iana` in the spec), not its source. Before A30 the table was recorded by
   * probing an implementation — first the JDK, then lokalized-java — and this field spent a slice
   * reading `jdk-oracle:21.0.11` because no snapshot existed to date it.
   *
   * **WHY THE DATE IS SAFE TO COMPARE EVEN THOUGH IT DOES NOT DETERMINE THE DATA.** Two builds could
   * share this File-Date and differ in the authored region/variant order. That is what
   * `ianaDataFingerprint` is for: plan 5.1 :1680-1682 fingerprints the lock's projection, which binds
   * the snapshot's digest, the compatibility input's digest and the artifact's digest together. The
   * date is provenance; the fingerprint is the data.
   *
   * "oracle", in this project's older texts, was the TESTING term — a reference implementation to
   * compare against — never Oracle Corporation. No Oracle software is involved anywhere in this
   * project: the JDK used for checks is Amazon Corretto, a build of OpenJDK under GPLv2 with the
   * Classpath Exception, which this package neither ships nor links.
   */
  ianaRegistryDate: "2026-09-17",

  // `lokalized-spec generated/iana-data-lock.json`'s `ianaDataFingerprint` (lock format 2), which
  // `test/runtime-metadata.test.js` RECOMPUTES from the lock's plan :1680-1682 projection rather than
  // copying. It moved at A30, so a manifest or SSR stamp produced by 1.0.0-rc.1 is refused by this
  // build: its IANA data is different, which is what the fingerprint exists to say.
  ianaDataFingerprint: "87b3a43b03f490206cead05d865357bd7cfc3953a52ec4d8405243f699385815",
});
