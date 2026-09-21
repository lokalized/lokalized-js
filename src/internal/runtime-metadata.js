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
 * ONE FIELD DIVERGES FROM THE PLAN AND IT IS A DECISION, NOT AN OVERSIGHT — see `ianaRegistryDate`.
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

  // `lokalized-spec generated/behavioral-vectors.json`'s own `behavioralVectorsVersion`.
  behavioralVectorsVersion: "1.0.0",

  // Plan 5.1 declares both as root metadata for THIS build: the port classifies from pinned CLDR
  // data and its selectors are the exact digit-string/BigInt interpreter, never `Intl`. They are
  // literal types rather than `string` because plan 6.4's strict hydration rule discriminates on
  // them, and a widened type would let a future host-`Intl` build satisfy this one's declaration.
  localeDataMode: /** @type {const} */ ("pinned"),
  cardinalityMode: /** @type {const} */ ("exact"),

  /**
   * **A RECORDED DIVERGENCE FROM PLAN 5.1, and it is the spec's decision rather than this port's.**
   *
   * Plan 5.1 defines this field as "`File-Date` of the pinned IANA Language Subtag Registry
   * snapshot". There is no such snapshot: `lokalized-spec generated/IANA-PROVENANCE.md:21` records
   * that the range-equivalence closure is derived "directly from the JDK oracle by exhaustive probe"
   * instead, and stated the cost in its own words — "`ianaRegistryFileDate` is `null`. The artifact
   * is pinned to a JDK build, not to a registry release."
   *
   * **THAT WAS TRUE UNTIL M-R S11, AND THE MAINTAINER DECIDED THE SPELLING THIS DOCBLOCK RECORDED
   * AS OWED.** The registry snapshot §5.1 always wanted is now pinned —
   * `lokalized-spec/tools/iana-oracle/language-subtag-registry.txt`, `File-Date: 2026-09-17`, 9,296
   * records, sha256 `755fad43…` — so a real date exists to report and this field reports it, which
   * is what plan 7.3 defines the field as.
   *
   * **AND AS OF M-R S13 THE CLOSURE IS NOT THE JDK'S EITHER.** This paragraph used to open "THE
   * CLOSURE IS STILL THE JDK'S, AND NOTHING HERE PRETENDS OTHERWISE" and it outlived its own fact
   * by one slice: lokalized-java 3.1.0 carries a registry-sourced table and the pinned closure is
   * now derived by probing THE LIBRARY. Parity with lokalized-java is still the product, so the
   * behaviour tracks the reference implementation as it always did — what changed is which
   * implementation the data is read out of. `generated/iana-registry-overrides.json` enumerates the
   * 130 places the registry and the SHIPPED closure still disagree (it was 156 against the JDK's,
   * and that number was stale here too), verified by RECONSTRUCTION — applying them to the registry
   * closure reproduces the shipped artifact byte-identically — and `ianaClosureSource` below names
   * the build those overrides were measured against.
   *
   * **WHY THE DATE IS SAFE TO COMPARE EVEN THOUGH IT DOES NOT DETERMINE THE CLOSURE.** Two builds
   * could share this File-Date and carry different overrides. That is what `ianaDataFingerprint` is
   * for: it fingerprints the closure itself, so the pair discriminates where the date alone would
   * not. The date is provenance; the fingerprint is the data.
   *
   * The old value was `jdk-oracle:21.0.11`, and "oracle" there was the TESTING term — a reference
   * implementation to compare against — never Oracle Corporation. No Oracle software is involved
   * anywhere in this project: the JDK is Amazon Corretto, a build of OpenJDK under GPLv2 with the
   * Classpath Exception, which this package neither ships nor links. The maintainer read it as the
   * vendor, which is the second time a reader has, and that is reason enough for it to leave a wire
   * value that ships to every consumer.
   */
  ianaRegistryDate: "2026-09-17",

  /**
   * The build the equivalence closure was measured against, and the overrides recorded for.
   *
   * **IT READ `jdk-corretto:21.0.11` AFTER THE ORACLE STOPPED BEING THE JDK, and nothing could see
   * it.** These constants are hand-copied out of `lokalized-spec`'s artifacts with a comment naming
   * where each came from, and no gate compared them to those artifacts — so the one field whose
   * whole job is to say which implementation produced the closure went on naming the wrong one.
   * `test/runtime-metadata.test.js` now derives all three from the spec, which is the repair; the
   * corrected value is the same fix the artifact got, which records `libraryVersion` rather than
   * leaving a consumer to guess which build of the library answered.
   *
   * INFORMATIONAL, and deliberately NOT part of the manifest's compared build-identity set: a
   * different oracle produces a different closure, and `ianaDataFingerprint` already refuses that
   * pairing. Adding an eighth compared field would be a second format change buying nothing the
   * fingerprint does not already catch.
   */
  ianaClosureSource: "lokalized-java:3.1.0-SNAPSHOT",

  // `lokalized-spec generated/iana-data-lock.json`'s `ianaDataFingerprint`.
  ianaDataFingerprint: "42a658b350903ec3697499ecce103a08021cc4588ef60014045cf391786073c0",
});
