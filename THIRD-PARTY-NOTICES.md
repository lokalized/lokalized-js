# Third-Party Notices

This package includes generated data and ported code derived from third-party materials. The
notices below travel WITH the published package, because the material does: `npm pack` carries the
generated modules under `src/data/` and the ported sources under `src/internal/`.

## Unicode CLDR

Fifteen generated modules under `src/data/` encode plural rules, ordinal rules, plural ranges,
likely subtags, supplemental metadata, script metadata and the language/script/region/variant
validity sets, generated from these Unicode CLDR 48.2 files:

* `common/supplemental/plurals.xml`
* `common/supplemental/ordinals.xml`
* `common/supplemental/pluralRanges.xml`
* `common/supplemental/likelySubtags.xml`
* `common/supplemental/supplementalMetadata.xml`
* `common/supplemental/supplementalData.xml`
* `common/properties/scriptMetadata.txt`
* `common/validity/language.xml`
* `common/validity/script.xml`
* `common/validity/region.xml`
* `common/validity/variant.xml`

Source: https://github.com/unicode-org/cldr/tree/release-48-2

The data is generated, not vendored verbatim. Each of those fifteen modules carries this notice as
a preserved legal comment, so a bundler that keeps legal comments carries the attribution into the
artifact it produces. Modules elsewhere in the package read those tables and embed none of their
own.

## IANA language range equivalents

`src/data/iana-range-equivalents.js` and `src/data/iana-identity-equivalents.js` are generated and
are NOT CLDR data. They are derived from the IANA Language Subtag Registry.

Source: https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry

Pinned snapshot: File-Date `2026-09-17`, SHA-256
`755fad43283be7b41ebe3c89ad054b6eaf928f404f9c0edb74799e0eab74beb1`.

Derived from it: the first module encodes 781 language subtags in 369 equivalence classes; the
second encodes the subset core's single-locale matcher reads (243 subtags in 115 classes) together
with the 14 region and variant substitutions. Both are generated with no JDK, through
lokalized-spec's `generated/iana-language-equivalences.json`, and each module records the
snapshot's File-Date and SHA-256. The order in which the region and variant substitutions are tried
is not stated by the registry; it follows the JDK's own table, so that answers agree with
lokalized-java's.

## minimal-json

`src/internal/json-parse.js` is a behavioural port. Its own header records what it reproduces: "the
parts of the vendored `MinimalJson` reader whose behaviour is observable through the loader: the
accepted grammar, the surrogate-pairing rule, and the line/column of the first syntax error." The
upstream Java implementation this package is a port of embeds minimal-json itself and gives it a
notice of its own; this package embeds no minimal-json source and reimplements the observable
behaviour, and the acknowledgement is recorded here rather than left to be inferred.

Source: https://github.com/ralfstx/minimal-json (MIT)

## Unicode License v3

Applies to the CLDR-derived data above.

UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2019-2025 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0
