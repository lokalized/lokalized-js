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
  producerVersion: "0.0.0",

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
   * instead, and states the cost in its own words — "`ianaRegistryFileDate` is `null`. The artifact
   * is pinned to a JDK build, not to a registry release." That was a reasoned choice (it makes
   * divergence from lokalized-java structurally impossible), and it means a File-Date does not
   * exist to report.
   *
   * So this reports the pin that DOES exist — `iana-data-lock.json`'s `oracle.jdkVersion` — spelled
   * so it can never be mistaken for a registry date by a reader or a parser. It satisfies what the
   * field is FOR (an equality-compared identity that changes when the IANA behaviour changes) while
   * stating plainly that the registry identity is absent.
   *
   * **OWED TO THE MAINTAINER:** whether this spelling is the one v1 ships. It is a wire value inside
   * a strictly compared format, so changing it later is a format change; changing it TODAY is one
   * line and one test. Recorded in `planning/M8-STATUS.md`.
   */
  ianaRegistryDate: "jdk-oracle:21.0.11",

  // `lokalized-spec generated/iana-data-lock.json`'s `ianaDataFingerprint`.
  ianaDataFingerprint: "34691dc14568d59012fb1e0265d81fac3fe13f4705eca97b3d65cd954c08505e",
});
