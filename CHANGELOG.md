# Changelog

All notable changes to lokalized are recorded here. This package is a JavaScript port of
[lokalized-java](https://github.com/lokalized/lokalized-java) 3.1.0; where the two differ on purpose,
[DIVERGENCES.md](DIVERGENCES.md) lists it.

## 1.0.0 - 2026-10-05

First stable release. ESM for Node 20+, modern browsers and the qualified
Cloudflare `workerd` runtime, with zero runtime dependencies.

- Share JSON catalog syntax with the Java and Swift ports: expressions, recursive
  fragments, cardinal/ordinal/range plural selection and all ten language-form axes.
- Ship pinned CLDR 48.2 and IANA locale data, exact plural arithmetic, locale
  negotiation, bidi isolation and structured translation/fallback diagnostics.
- Provide browser, Node filesystem and caller-supplied catalog delivery, manifest
  validation and identity helpers, and SSR hand-off validation.
- Publish nine documented entry points, TypeScript declarations, browser ESM and
  classic-script distributions, and a generated API reference.

- Follow shared manifest-normalization profile 1.1.0: private-use-only
  `UND-x-foo` / `und-x-foo` claims and lookups stabilize as `x-foo` across
  validation, identity projection, planning and loader coverage. Loaded rendering
  and SSR compare coverage using that spelling while preserving core locale
  contexts. Republish affected manifests with fingerprints computed from normalized
  keys/values and regenerate SSR stamps. Wire format 1, the current tiebreaker name
  and arbitrary raw identity keys retain their contracts; no legacy alias is added.

- Follow shared diagnostic-text profile 1.1.0: repair a surrogate pair split by
  bounded diagnostic truncation with U+FFFD before the ellipsis, and cap nested
  manifest duplicate-member displays at the catalog’s existing 256 UTF-16 units.
  Paths retain the 4,096-unit cap. All 36 shared public-parser cases are digest
  pinned; native error/path field representations and public APIs are preserved.

- Align public configuration, matching, and translation callback names with Java's vocabulary
- Supply catalogs through `localizedStringSupplier`, called once during synchronous construction
- Use the same option names in manifests, returned configuration records, and per-call options
- Use `"always"` for the bidi mode corresponding to Java's `BidiIsolation.ALWAYS`
- Remove the earlier candidate spellings before freezing the stable public API
- Use `localeMatchResult` consistently in lookup diagnostics, options, helpers, and SSR stamps
- Rename the loading error to `LocalizedStringLoadingError`
- Export shared result, callback, bidi, and language-form type names from the root and core
- Type `PhoneticResolver` to return a phonetic form
