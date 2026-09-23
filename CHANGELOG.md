# Changelog

All notable changes to lokalized are recorded here. This package is a JavaScript port of
[lokalized-java](https://github.com/lokalized/lokalized-java) 3.1.0; where the two differ on purpose,
[DIVERGENCES.md](DIVERGENCES.md) lists it.

## Unreleased

Changes since 1.0.0-rc.1. This is still a release-candidate line, so the breaking changes below were
made where the old behaviour failed silently.

### Breaking changes

- **Language-range equivalents now come from a pinned IANA Language Subtag Registry snapshot**
  (`File-Date: 2026-09-17`), the same data lokalized-java 3.1.0 uses by default, instead of a table
  extracted from JDK 21. Three answers change:
  - `parseLanguageRanges` now expands 12 deprecated tags that it returned alone before. For example,
    `yol` now also yields `enm`, and `mgp` yields `mrd`.
  - A single-locale request that combines a language equivalent with a region or variant
    substitution now matches, as it does in Java. For example, `mgp-BU` now matches a loaded `mrd-MM`
    where it matched nothing.
  - A range made only of hyphens (`-`) is refused with Java's message
    `Index 0 out of bounds for length 0` instead of `range=-`. It is still a `RangeError`, and the
    `Accept-Language` functions still fall back rather than throw.
- **`ianaDataFingerprint` and `behavioralVectorsVersion` changed** (to `87b3a43b…` and `1.1.0`). A
  manifest or SSR stamp produced with 1.0.0-rc.1 is refused by this version. Regenerate manifests
  with `createStringsManifestFromDirectory`.
- **More functions refuse an option they do not take**, with a `ConfigurationError` that names the
  option and, for a near miss, the spelling that works: `createLocaleNegotiator`,
  `chooseLocaleForPreferredLanguages`, `chooseBrowserLocale`, the per-call options of
  `strings.get`, `strings.t` and `strings.getResult`, `chain`, `fetchSet` and `pluralOperands`.
- **A non-object where an options object belongs is refused.** `undefined`, `null` and `false` still
  mean "no options", so `cond && { locale }` keeps working. `0`, `""`, a string, a function or `true`
  throws a `ConfigurationError` naming the function. For example, `strings.get("Hi", undefined, "fr")`
  used to render in the instance's locale; pass `{ locale: "fr" }` instead. A transport handed over
  directly, `loadStrings(manifest, locale, myFetch)`, was ignored in favour of the global `fetch`;
  pass `{ fetch: myFetch }`. A promise (or any thenable) in the options position is refused the same
  way: `loadStrings(manifest, locale, loadConfig())` with a forgotten `await` used to read as "no
  options" and went to the global `fetch`.
- **A language range with a member other than `range` and `weight` is refused** with a `RangeError`
  by `matchForLanguageRanges`, `bestMatchForLanguageRanges` and `forLanguageRanges`. A misspelling
  such as `{ range: "fr", wieght: 0 }` used to be read as weight 1.
- **TypeScript: the Fetch loaders' options are typed.** `loadStrings` and `loadEntireManifest` took
  `any` and now take `LoadStringsOptions`, so a misspelled option or `partialFailure` policy fails to
  compile. `request` is declared with `mode` and `credentials` only; other `RequestInit` members are
  still forwarded at run time but no longer type-check. The Node file loaders' `partialFailure` is
  typed `"reject" | "allow-partial"`.

### Fixed

- A load that rejects while one of its reads is still in flight (an abort with a transport that
  ignores the signal, for example) no longer keeps that read's catalog alive through the rejection
  the caller holds.
- Passing `null` as the options argument no longer crashes with a `TypeError` at the functions whose
  options are optional.
- `createStrings`, `parseStrings` and `loadStringsFromDirectory`, whose options are required, answer
  `undefined`, `null` and `false` alike, with their own error: a `RangeError` ("A locale tag must be a
  non-empty string") from the first two and a `ConfigurationError` ("`catalogVersion` must be a
  non-empty string") from the directory loader. `undefined` and `null` used to throw a `TypeError`
  ("Cannot read properties of null"), and `false` a different error.

### Changed

- The `fetch` option is typed as the call the loader makes, `(url, init) => Promise<Response>` with a
  string URL, so a custom transport typed `(url: string) => Promise<Response>` type-checks. The
  global `fetch` still does.

## 1.0.0-rc.1 - 2026-09-22

- First release candidate, published to npm.
