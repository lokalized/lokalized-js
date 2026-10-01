# Changelog

All notable changes to lokalized are recorded here. This package is a JavaScript port of
[lokalized-java](https://github.com/lokalized/lokalized-java) 3.1.0; where the two differ on purpose,
[DIVERGENCES.md](DIVERGENCES.md) lists it.

## 1.0.0 - Unreleased

First release.

- Align public configuration, matching, and translation callback names with Java's vocabulary
- Supply catalogs through `localizedStringSupplier`, called once during synchronous construction
- Use the same option names in manifests, returned configuration records, and per-call options
- Use `"always"` for the bidi mode corresponding to Java's `BidiIsolation.ALWAYS`
- Remove the earlier candidate spellings before freezing the stable public API
- Use `localeMatchResult` consistently in lookup diagnostics, options, helpers, and SSR stamps
- Rename the loading error to `LocalizedStringLoadingError`
- Export shared result, callback, bidi, and language-form type names from the root and core
- Type `PhoneticResolver` to return a phonetic form
