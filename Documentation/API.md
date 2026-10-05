# Lokalized JavaScript API

This reference describes the exported functions, types, options, and callbacks
of the JavaScript package. It also serves TypeScript consumers: the signatures
come from the declarations generated from the library's checked JSDoc.
The derived `Strings` type alias is presented as an interface so its methods
are directly navigable; it remains a type alias in the shipped declarations.

Use the [Lokalized guide](https://www.lokalized.com/?platform=javascript) for
installation, translation files, browser and Node.js examples, and the cookbook.

## Entry points

- `lokalized`: translation runtime, parser, language forms, cardinal rules, and locale data.
- `lokalized/core`: core runtime and construction contracts.
- `lokalized/parse`: parse and define localized strings, with diagnostics and loading limits.
- `lokalized/load`: manifest validation, identity, planning, and browser-compatible loading.
- `lokalized/negotiate`: locale matching and preferred-language negotiation.
- `lokalized/ssr`: server-rendering stamps and validation.
- `lokalized/node`: local filesystem loading for Node.js.
- `lokalized/data/ordinal`: optional ordinal plural data.
- `lokalized/data/ranges`: optional cardinal range data.

The **Supporting types** group explains additional definitions referenced by
public signatures. It is a documentation group, not a package import path.
It exposes no additional runtime exports.

## Important contracts

Create a strings instance with exactly one `localeSupplier` or
`localeMatchSupplier`. The supplier is consulted for lookups without a per-call
locale override. The fallback locale is a separate setting.

Use `decimal` and `pluralOperands` when visible decimal places or exact numeric
text affect plural selection. Display formatting belongs to the application.

Callbacks are synchronous. Exceptions from application callbacks propagate;
returned strings are literal display values unless the corresponding API
explicitly documents interpolation. Use `getResult` when you need the selected
locale, attempted locales, or failure details alongside the translated text.

The library has zero runtime dependencies. TypeDoc and TypeScript are development
tools used to produce this reference.
