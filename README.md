# lokalized

Natural-sounding translations in JavaScript, with no runtime dependencies.

Lokalized keeps locale-specific grammar out of your application code. Plural rules, gender agreement,
grammatical case, formality and the rest live **with the translations**, where a translator can reach
them — not scattered through conditionals in your components.

This is a JavaScript port of [lokalized-java](https://github.com/lokalized/lokalized-java), behaviour-for-behaviour.
Every rule below is arbitrated against the Java implementation by an executed test corpus rather than
by description.

```bash
npm install lokalized@1.0.0-rc.1
```

**Pin the version.** `1.0.0-rc.1` is a release candidate, published under the `next` dist-tag — but
npm sets `latest` to the first version of a package whatever tag you publish it under, so a bare
`npm install lokalized` resolves to this release candidate today rather than failing. Measured
against the registry on 2026-09-21: `{ next: 1.0.0-rc.1, latest: 1.0.0-rc.1 }`. Naming the version
is how you say which one you meant, and it is what this document's CDN section asks for too.

Requires Node 20+ or any modern browser. **Zero dependencies.** ESM only.
Node 20 reached end of life on 2026-04-30 and the floor names it because a great many projects
still run it — nothing here needs a newer runtime, and CI proves that on a `20` leg. Choose it
deliberately.

One worker runtime is tested: Cloudflare's open-source `workerd`, running the packed package's
files unbundled and required to answer every probe exactly as Node does (`npm run smoke:worker`,
in CI). Nothing here tests any other worker runtime.

Every code sample below is executed by `npm run check:readme`, and every output it claims is
asserted — so a sample that has gone stale fails the build rather than misleading you.

**Writing translations** &nbsp;[Quickstart](#quickstart) · [The catalog format](#the-catalog-format) ·
[Language forms](#language-forms-are-values-not-strings) · [Locale matching](#locale-matching)

**Running them** &nbsp;[Loading translations](#loading-translations) ·
[Negotiating from `Accept-Language`](#negotiating-from-accept-language) ·
[Diagnostics](#diagnostics) · [Failure handling](#failure-handling) · [Limits](#limits)

**Shipping** &nbsp;[Right-to-left text, `lang` and `dir`](#right-to-left-text-lang-and-dir) ·
[One instance, many requests](#one-instance-many-requests) ·
[Server rendering and the client hand-off](#server-rendering-and-the-client-hand-off) ·
[Caching a localized page](#caching-a-localized-page) ·
[Bundling and Content Security Policy](#bundling-and-content-security-policy)

**Reference** &nbsp;[Coming from lokalized-java](#coming-from-lokalized-java) ·
[Entry points](#entry-points) ·
[What this port does and does not do](#what-this-port-does-and-does-not-do)

---

## Quickstart

<!-- example: quickstart -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({
  strings: {
    en: {
      "Cart.Items": {
        translation: "Your cart holds {{count}} {{books}}.",
        placeholders: {
          books: {
            value: "count",
            translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
          },
        },
      },
    },
    fr: {
      "Cart.Items": {
        translation: "Votre panier contient {{count}} {{books}}.",
        placeholders: {
          books: {
            value: "count",
            translations: { CARDINALITY_ONE: "livre", CARDINALITY_OTHER: "livres" },
          },
        },
      },
    },
  },
  fallbackLocale: "en",
  locale: "fr",
});

strings.get("Cart.Items", { count: 1 });   // => "Votre panier contient 1 livre."
strings.get("Cart.Items", { count: 3 });   // => "Votre panier contient 3 livres."
```

`count` never appears in a conditional in your code. The French catalog decides that `1` is
`CARDINALITY_ONE` and everything else is `CARDINALITY_OTHER`; a Polish catalog would decide
differently, and neither decision reaches your components.

**A per-call locale overrides the instance one**, which is what a server handling many requests needs:

<!-- example: quickstart -->

```js
strings.get("Cart.Items", { count: 3 }, { locale: "en" });      // => "Your cart holds 3 books."
strings.get("Cart.Items", { count: 3 }, { locale: "fr-CA" });   // => "Votre panier contient 3 livres."
```

`fr-CA` has no catalog here, so it resolves to `fr` — see [Locale matching](#locale-matching).

---

## The catalog format

A catalog is JSON. The simplest entry is a string:

```json
{ "Checkout.Cta": "Check out" }
```

`{{name}}` interpolates a value you pass at call time. To make a value *change the words*, give the
key a `placeholders` map — each placeholder reads one of your values and picks a fragment from it:

```json
{
  "Greeting": {
    "translation": "Welcome back, {{name}}. {{youAre}} on your own reading list.",
    "placeholders": {
      "youAre": {
        "value": "readerGender",
        "translations": {
          "GENDER_MASCULINE": "He is",
          "GENDER_FEMININE": "She is",
          "GENDER_COMMON": "They are"
        }
      }
    }
  }
}
```

### Alternatives rewrite the whole message

When a fragment is not enough — when the natural sentence is a *different* sentence — a translator
adds `alternatives`. Each is an expression; the first one that matches wins, and the root's
placeholders stay available to it:

<!-- example: alternatives -->

```js
import { createStrings, GENDER_FEMININE, GENDER_MASCULINE } from "lokalized";

const strings = createStrings({
  strings: {
    en: {
      "Players": {
        translation: "{{heOrShe}} was one of the {{groupSize}} best players.",
        placeholders: {
          heOrShe: {
            value: "heOrShe",
            translations: { GENDER_MASCULINE: "He", GENDER_FEMININE: "She", GENDER_COMMON: "They" },
          },
        },
        alternatives: [{ "groupSize <= 1": "{{heOrShe}} was the best player." }],
      },
    },
  },
  fallbackLocale: "en",
  locale: "en",
});

strings.get("Players", { heOrShe: GENDER_FEMININE, groupSize: 5 });
// => "She was one of the 5 best players."

strings.get("Players", { heOrShe: GENDER_MASCULINE, groupSize: 1 });
// => "He was the best player."
```

Expressions support comparison (`==`, `!=`, `<`, `<=`, `>`, `>=`), `&&`, `||`, and parentheses over
the values you passed and the language-form constants. They are compiled when the catalog **loads**,
so a malformed one fails there rather than mid-render, in front of a user:

<!-- example: alternatives -->

```js
const compiles = (expression) => {
  try {
    createStrings({
      strings: { en: { Players: { translation: "base", alternatives: [{ [expression]: "alt" }] } } },
      fallbackLocale: "en",
      locale: "en",
    });
    return "loaded";
  } catch (error) {
    return error.constructor.name;
  }
};

compiles("groupSize <= 1");    // => "loaded"
compiles("(groupSize <= 1");   // => "ExpressionEvaluationError"
```

### Language forms are values, not strings

**Pass the exported constant, not its name.** `GENDER_FEMININE` is a frozen tagged value, and a bare
`"GENDER_FEMININE"` string is a different thing — the resolution fails and you get the key back:

<!-- example: forms -->

```js
import { GENDER_FEMININE } from "lokalized";

GENDER_FEMININE.axis;         // => "gender"
GENDER_FEMININE.name;         // => "GENDER_FEMININE"
GENDER_FEMININE.renderName;   // => "FEMININE"
```

In TypeScript each constant carries its own literal type, so `GENDER_FEMININE.axis` is `"gender"` and
not `string`.

**Recognition is structural, not by identity.** A spread clone, a `structuredClone` or a JSON
round-trip of a constant works exactly as the constant does — which is what lets a form cross a
worker boundary or a server/client boundary — while a bare string does not:

<!-- example: forms -->

```js
import { createStrings } from "lokalized";

const reader = createStrings({
  strings: {
    en: {
      Reader: {
        translation: "{{isHere}}.",
        placeholders: {
          isHere: {
            value: "gender",
            translations: { GENDER_FEMININE: "She is here", GENDER_MASCULINE: "He is here" },
          },
        },
      },
    },
  },
  fallbackLocale: "en",
  locale: "en",
});

reader.get("Reader", { gender: GENDER_FEMININE });                    // => "She is here."
reader.get("Reader", { gender: { ...GENDER_FEMININE } });             // => "She is here."
reader.get("Reader", { gender: structuredClone(GENDER_FEMININE) });   // => "She is here."

// A bare string is a different thing, so the resolution fails and you get the key back.
reader.get("Reader", { gender: "GENDER_FEMININE" });                  // => "Reader"
```

### The axes

The root exports 61 constants across ten axes. Rather than trust a table in a README, derive it:

<!-- example: forms -->

```js
import * as lokalized from "lokalized";

// Every language form is a frozen record tagged `$lokalized: "language-form"`.
const forms = Object.values(lokalized).filter((value) => value?.$lokalized === "language-form");

forms.length;                                   // => 61
new Set(forms.map((form) => form.axis)).size;   // => 10

const counts = {};
for (const form of forms) counts[form.axis] = (counts[form.axis] ?? 0) + 1;

counts;
// => {"animacy":2,"cardinality":6,"grammatical-case":9,"classifier":8,"clusivity":2,"definiteness":3,"formality":5,"gender":4,"ordinality":6,"phonetic":16}

// One axis's name is not its prefix: `grammatical-case` spells its nine constants `CASE_*`.
const prefixOf = (form) => (form.axis === "grammatical-case" ? "CASE_" : `${form.axis.toUpperCase()}_`);

forms.filter((form) => !form.name.startsWith(prefixOf(form))).length;   // => 0
```

### Who picks the form

The axis decides, and it is worth knowing which kind you are holding:

- **The library classifies it** for `cardinality` and `ordinality`. You pass a *number*; pinned CLDR
  data decides whether English `1` is `CARDINALITY_ONE`. Passing a constant where a number belongs is
  accepted rather than refused — and it renders the constant's short name into your sentence, which
  is how you find out:

<!-- example: forms -->

```js
import { CARDINALITY_ONE } from "lokalized";

const cart = createStrings({
  strings: {
    en: {
      Cart: {
        translation: "{{count}} {{books}}",
        placeholders: {
          books: {
            value: "count",
            translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
          },
        },
      },
    },
  },
  fallbackLocale: "en",
  locale: "en",
});

cart.get("Cart", { count: 1 });                 // => "1 book"
cart.get("Cart", { count: 3 });                 // => "3 books"
cart.get("Cart", { count: CARDINALITY_ONE });   // => "ONE book"
```

- **You supply it** for gender, grammatical case, definiteness, classifier, formality, clusivity and
  animacy. There is nothing to compute — your application knows the subject's gender.
- **A resolver you configure classifies it** for `phonetic`. You pass a term as a string and the
  `phoneticResolver` you gave `createStrings` returns the form, under the *supplying catalog's*
  locale.

---

## Locale matching

Matching is deterministic and it is not "closest string". It follows CLDR: exact tag, then parent
locales, then likely-script maximization, then the configured fallback.

<!-- example: matching -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({
  strings: { en: { Hi: "Hello" }, fr: { Hi: "Bonjour" }, "fr-CA": { Hi: "Salut" } },
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
  locale: "en",
});

strings.get("Hi", undefined, { locale: "fr-CA" });   // => "Salut"
strings.get("Hi", undefined, { locale: "fr-CH" });   // => "Bonjour"
strings.get("Hi", undefined, { locale: "de" });      // => "Hello"
```

**That `undefined` is a slot, not a placeholder for nothing in particular.** `get` takes three
arguments in this order — the key, the *values* your translation interpolates, and the *options* that
decide which locale answers:

```
strings.get(key, values, options)
```

The two are separate bags, and putting a locale in the first one is the mistake worth knowing about,
because **it does not fail — it quietly serves the instance's locale instead**:

<!-- example: matching -->

```js
strings.get("Hi", undefined, { locale: "fr" });        // => "Bonjour"

// Wrong, and it does not say so: a locale in the VALUES bag is just a value.
strings.get("Hi", { locale: "fr" });                   // => "Hello"

// Wrong, and refused: the options slot takes an options object, not a tag.
(() => { try { return strings.get("Hi", undefined, "fr"); } catch (error) { return error.name; } })();
// => "ConfigurationError"
```

A `locale` in the values bag is not a typo the library can see: it is a value in the wrong bag, and
the bag is a real parameter. The options slot is stricter — it refuses anything that is not an
object (apart from `undefined`, `null` and `false`, which mean none), and an unrecognised *member*
of one (see
[Every door refuses an option it does not recognise](#every-door-refuses-an-option-it-does-not-recognise))
— but neither helps with the first mistake, because `locale` is a member every one of these doors
knows.

### Ambiguity is refused, not guessed

That `tiebreakers` entry is not optional. With both `fr` and `fr-CA` loaded, a request for plain `fr`
is ambiguous — and rather than pick one, **construction fails and tells you what to declare**:

<!-- example: ambiguity -->

```js
import { createStrings } from "lokalized";

const ambiguous = () => createStrings({
  strings: { fr: { Hi: "Bonjour" }, "fr-CA": { Hi: "Salut" } },
  fallbackLocale: "fr",
  locale: "fr",
});

let refusal = "";
try { ambiguous(); } catch (error) { refusal = `${error.name}: ${error.message}`; }

refusal;
// => "RangeError: You must specify tiebreaker locales via createStrings({ tiebreakers }) to resolve ambiguity for language code 'fr' because localized strings exist for the following locale[s]: [fr, fr-CA]"
```

The same reflex runs throughout: a configuration that could silently serve the wrong language is
refused at construction, where you can see it, instead of at render time in production.

---

## Loading translations

### From a directory (Node)

<!-- example: directory -->

```js
import { createStrings } from "lokalized/core";
import { readStringsFromDirectory } from "lokalized/node";

const { catalogs, warnings } = readStringsFromDirectory("examples/catalogs");

Object.keys(catalogs);   // => ["en", "es", "fr", "fr-CA"]

const strings = createStrings({
  strings: catalogs,
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
  locale: "fr",
});

strings.get("Cart.Items", { count: 2 });   // => "Votre panier contient 2 livres."
```

**Read that `warnings` array.** Destructuring it and moving on is the natural thing to write and it
is how an incomplete catalog ships: the load succeeds, every number you test renders, and one input
you did not test returns the key. These four catalogs are clean, which is a fact worth asserting
rather than assuming —

<!-- example: directory -->

```js
warnings.map((warning) => warning.type);   // => []
```

— and the cheapest policy is to refuse to start when they are not. See
[How many forms a language needs](#how-many-forms-a-language-needs-is-not-two-and-not-a-thing-to-guess),
which is the gap these warnings most often report.

Each file is named for its locale — `en.json`, `fr-CA.json`. Loading is bounded: file count, total
bytes, translation nodes and warnings all have limits, so a hostile or corrupt directory fails
closed rather than exhausting memory.

`examples/catalogs` is this document's own four-file set, printed in full under
[The catalogs these samples use](#the-catalogs-these-samples-use) — every directory sample below
reads it, so you can reproduce their output exactly. Point the path at your own directory instead
and nothing else changes.

### The same load, when the catalogs are not clean

The array above is empty because `examples/catalogs` is complete, which makes the check read like a
formality. This is what a gap looks like. The catalog below is French and declares two forms —
`CARDINALITY_ONE` and `CARDINALITY_OTHER` — which is the shape an English example teaches and which
French does not have:

<!-- catalog: examples/incomplete-catalog/fr.json -->

```json
{
  "Books": {
    "translation": "{{count}} {{books}}",
    "placeholders": {
      "books": {
        "value": "count",
        "translations": {
          "CARDINALITY_ONE": "livre",
          "CARDINALITY_OTHER": "livres"
        }
      }
    }
  },

  "Photos": {
    "translation": "{{count}} {{photos}}",
    "placeholders": {
      "photos": {
        "value": "count",
        "translations": {
          "CARDINALITY_ONE": "photo",
          "CARDINALITY_OTHER": "photos"
        }
      }
    }
  }
}
```

`readStringsFromDirectory` takes an **`onWarning`** observer, called once per warning as the file is
parsed. It arrives alongside the returned `warnings` array rather than instead of it, so a caller
that wants to log or count as it goes does not have to wait for the load to finish:

<!-- example: onwarning -->

```js
import { readStringsFromDirectory } from "lokalized/node";

const streamed = [];
const { warnings } = readStringsFromDirectory("examples/incomplete-catalog", {
  onWarning: (warning) => { streamed.push(warning); },
});

streamed.map((warning) => warning.type);
// => ["INCOMPLETE_CARDINALITY_TRANSLATIONS", "INCOMPLETE_CARDINALITY_TRANSLATIONS"]

streamed.length === warnings.length;   // => true
```

Each one names the locale, the key, the placeholder and exactly which forms are missing, which is
enough to write the line a build log should carry without opening the catalog:

<!-- example: onwarning -->

```js
const describe = (warning) =>
  `${warning.locale} ${warning.key}.${warning.placeholder} wants ${warning.missingLanguageForms.join(", ")}`;

streamed.map(describe);
// => ["fr Books.books wants CARDINALITY_MANY", "fr Photos.photos wants CARDINALITY_MANY"]

streamed[0].source.endsWith("examples/incomplete-catalog/fr.json");   // => true
```

Use it. A warning is not a failure and will not stop your process, so the decision to stop is yours
to write down:

<!-- example: onwarning -->

```js
const refuseToBoot = warnings.length === 0
  ? null
  : `${warnings.length} incomplete catalog translation(s); refusing to start`;

refuseToBoot;   // => "2 incomplete catalog translation(s); refusing to start"
```

**And there is one case where the observer is the only route to a warning at all.** Warnings stream:
everything delivered before an abort stays delivered, and the load that aborts returns no record to
read them from. The warning budget is the cheapest way to see it — cap it below what this directory
produces, and the load throws after the first warning has already been handed over:

<!-- example: onwarning -->

```js
const beforeTheAbort = [];
let refused = null;

try {
  readStringsFromDirectory("examples/incomplete-catalog", {
    limits: { maximumWarnings: 1 },
    onWarning: (warning) => { beforeTheAbort.push(warning); },
  });
} catch (error) {
  refused = error.constructor.name;
}

refused;   // => "StringsParseError"
beforeTheAbort.map((warning) => warning.key);   // => ["Books"]
```

`createStrings` and `parseStrings` take the same `onWarning` option, with the same shape and the same
timing. **The network and manifest loaders do not** — `loadStrings`, `loadEntireManifest` and their
Node-file siblings hand their warnings back on the record they return, as `loaded.warnings`, and
passing them an `onWarning` is refused by name rather than ignored. After construction every route
converges: `strings.getWarnings()` reports what the instance was built from, whichever door it came
through.

### Over the network (browser, edge, or server)

`lokalized/load` fetches only the catalogs a given locale needs, verifies each against a SHA-256
digest recorded in a manifest, and hands back a record you pass straight to `createStrings`.

In production the origin below is your CDN. Here it is six lines of `node:http` serving this
document's own catalogs, so that every line that follows is executed rather than illustrated:

<!-- example: network -->

```js
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

let published = "";
const served = [];
const broken = new Map();   // the failure sample at the end of this section breaks the CDN on purpose
const server = createServer((request, response) => {
  const name = new URL(request.url, "http://cdn.example").pathname.slice(1);
  served.push(name);
  if (broken.has(name)) return response.end(broken.get(name));
  response.end(name === "manifest.json" ? published : readFileSync(`examples/catalogs/${name}`));
}).listen(0);
const origin = `http://127.0.0.1:${server.address().port}`;
```

The manifest is generated once, at publish time, from the directory of catalogs. It is the list of
files, the URL each is published at, and the digest of the bytes each one must contain:

<!-- example: network -->

```js
import { createStringsManifestFromDirectory } from "lokalized/node";

const manifest = await createStringsManifestFromDirectory("examples/catalogs", {
  catalogVersion: "2026-09-17",
  fallbackLocale: "en",
  publicationBaseUrl: `${origin}/`,
  tiebreakers: { fr: ["fr", "fr-CA"] },
});
published = JSON.stringify(manifest);

Object.keys(manifest.files);             // => ["en", "es", "fr", "fr-CA"]
manifest.files["fr-CA"].url;             // => "fr-CA.json"
manifest.files["fr-CA"].decodedBytes;    // => 876
manifest.files["fr-CA"].sha256.length;   // => 64
```

`tiebreakers` is not optional here: the generator applies the rule construction applies, so a
directory holding both `fr.json` and `fr-CA.json` is refused at publish time rather than at load
time. For a fetched instance the manifest is the only door tiebreakers can enter through.

At runtime — in a browser, an edge worker, or a server — you fetch the manifest and hand it to the
loader:

<!-- example: network -->

```js
import { createStrings } from "lokalized/core";
import { loadStrings, parseStringsManifest } from "lokalized/load";

const fetched = parseStringsManifest(await (await fetch(`${origin}/manifest.json`)).text());
const loaded = await loadStrings(fetched, "fr-CA");

Object.keys(loaded.catalogs);   // => ["fr-CA", "fr", "en"]
loaded.complete;                // => true

const strings = createStrings({ loaded, locale: "fr-CA" });

strings.get("Cart.Items", { count: 2 });   // => "Votre panier compte 2 livres."
```

**Three catalogs arrive for one locale, not four.** `fr-CA` needs `fr-CA`, its parent `fr` and the
fallback `en`. `es` is published and never requested, which is the whole point of a manifest — and
it is worth asserting rather than assuming, because the result is identical either way:

<!-- example: network -->

```js
served;                                          // => ["manifest.json", "fr-CA.json", "fr.json", "en.json"]
served.filter((name) => name === "es.json");     // => []
```

**And a CDN serving the wrong bytes fails closed with the locale named**, rather than rendering
someone else's words. Worth executing rather than asserting, because the interesting part is *which*
check catches it. Change a single letter in one catalog, keeping its length identical, and the
digest is what refuses — a body of a different length never gets that far, because the manifest also
declares each file's decoded size and that is checked first:

<!-- example: network -->

```js
const honest = readFileSync("examples/catalogs/fr.json", "utf8");
const swapped = honest.replace("livre", "livrE");

swapped.length === honest.length;   // => true

broken.set("fr.json", swapped);
const refused = await loadStrings(fetched, "fr-CA").then(() => null, (error) => error);

[refused.name, refused.code];                              // => ["StringsLoadingError", "STRINGS_LOADING"]
refused.failures.map(({ locale, stage }) => [locale, stage]);   // => [["fr", "digest"]]
```

The default is all-or-nothing: one bad file and nothing loads. An edge deployment that would rather
serve a degraded page than none can say so, and is told exactly what it lost:

<!-- example: network -->

```js
const partial = await loadStrings(fetched, "fr-CA", { partialFailure: "allow-partial" });

partial.complete;                 // => false
Object.keys(partial.catalogs);    // => ["fr-CA", "en"]
```

`fr` is gone and `fr-CA` plus the `en` fallback remain, so a French-Canadian visitor still gets a
page — in French where `fr-CA.json` has the key and in English where it does not. `complete` is how
you decide whether that is acceptable; it is never decided for you.

**And the subset is a subset.** This instance was planned from `fr-CA` alone, so asking it for a
locale outside that chain is refused rather than answered from a catalog nobody chose:

<!-- example: network -->

```js
const outside = (() => {
  try { return strings.get("Cart.Items", { count: 2 }, { locale: "es" }); }
  catch (error) { return error.code; }
})();

outside;   // => "CONFIGURATION"

server.close();
```

Call `loadEntireManifest` instead of `loadStrings` when you want every declared locale in one
instance. `lokalized/node` has the same doors over the filesystem, for a server that reads its
catalogs from disk rather than over HTTP.

---

## Negotiating from `Accept-Language`

`lokalized/negotiate` carries the full RFC 4647 solver — q-values, wildcards, and the full IANA
language-equivalence table generated from the pinned registry. It is a **separate entry point on
purpose**: the whole-list solver is large, and keeping it out of the rendering graph is the reason you
can ship the core to a browser.

<!-- example: negotiate -->

```js
import { createStrings } from "lokalized";
import { createLocaleNegotiator, forAcceptLanguage } from "lokalized/negotiate";

const strings = createStrings({
  strings: { en: { Hi: "Hello" }, fr: { Hi: "Bonjour" }, "fr-CA": { Hi: "Salut" }, es: { Hi: "Hola" } },
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
  locale: "en",
});

const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());

const options = forAcceptLanguage(negotiator, "fr-CA,fr;q=0.9");
strings.get("Hi", undefined, options);        // => "Salut"
options.localeMatch.matchType;                // => "exact"

strings.get("Hi", undefined, forAcceptLanguage(negotiator, "fr-CH"));   // => "Bonjour"
```

**`matchType` has eight values and the declaration names them**, as the exported type
`LocaleMatchType` on `lokalized/core`. They are `exact`, `canonical`, `cldr-fallback`,
`likely-subtag`, `extended-range`, `primary-language`, `wildcard` and `none`. In TypeScript a
`switch` over them exhausts, so leaving one out is a compile error rather than a branch you find in
production. Six of the eight come out of ordinary headers:

<!-- example: negotiate -->

```js
const wide = createLocaleNegotiator({
  supportedLocales: ["en", "fr", "fr-CA", "he", "zh-Hant", "de-DE"],
  fallbackLocale: "en",
});
const typeOf = (header) => forAcceptLanguage(wide, header).localeMatch.matchType;

[typeOf("fr-CA"), typeOf("fr-FR"), typeOf("de-AT"), typeOf("*"), typeOf("zh")];
// => ["exact", "cldr-fallback", "likely-subtag", "wildcard", "none"]
```

Only `none` means nothing matched — everything else served the visitor something, and the one you
most want to notice is `wildcard`, where the visitor expressed no preference at all. `none` is also
the case where `localeMatch.locale` is `null` rather than a tag, so a page that binds `<html lang>`
straight from it emits `lang="null"`.

**Header handling is fail-soft.** A malformed header is a thing browsers and bots really send, so it
never throws — it produces an *unmatched* result that renders in your configured fallback while still
telling the page that nothing matched:

<!-- example: negotiate -->

```js
const bad = forAcceptLanguage(negotiator, "fr;q=2");

strings.get("Hi", undefined, bad);   // => "Hello"
bad.localeMatch.locale;              // => null
bad.localeMatch.matchType;           // => "none"
```

That distinction matters for caching: a page rendered for a visitor who asked for nothing is not the
same page as one rendered for a visitor whose language you do not publish.

---

## Diagnostics

`get` returns a string. `getResult` returns the string plus everything the library decided on the
way — which locale it looked up, which catalog answered, whether that was a fallback:

<!-- example: diagnostics -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({
  strings: { en: { Hi: "Hello" }, fr: { Hi: "Bonjour" } },
  fallbackLocale: "en",
  locale: "fr",
});

const result = strings.getResult("Hi", undefined, { locale: "fr-CA" });

result.translation;      // => "Bonjour"
result.lookupLocale;     // => "fr-CA"
result.resolvedLocale;   // => "fr"
result.isFallback;       // => true
result.status;           // => "translated"
```

### A missing key returns the key

Rendering never throws for a missing translation — you get the key back, which is visible in the UI
and harmless in production. `getResult` tells you it happened:

<!-- example: diagnostics -->

```js
strings.get("Nope");                     // => "Nope"
strings.getResult("Nope").status;        // => "returned-key"
strings.getResult("Nope").failureReason; // => "missing-translation"
```

That is a policy, not a law — see [Failure handling](#failure-handling).

### Catalog problems surface as warnings

<!-- example: warnings -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({
  strings: {
    en: {
      K: {
        translation: "{{p}}",
        placeholders: { p: { value: "n", translations: { CARDINALITY_ONE: "one" } } },
      },
    },
  },
  fallbackLocale: "en",
  locale: "en",
});

strings.getWarnings().map((warning) => warning.type);
// => ["INCOMPLETE_CARDINALITY_TRANSLATIONS"]
```

English needs `CARDINALITY_OTHER` too. The catalog still loads — a warning is not a failure — but the
gap is reported rather than discovered by a user.

### How many forms a language needs is not two, and not a thing to guess

The example above is English, where the answer happens to be two. **It is two for English and for
almost nothing else you will ship.** Ask the library rather than inferring the pattern from a sample:

<!-- example: cardinal-forms -->

```js
import { cardinalityForNumber, supportedCardinalitiesForLocale } from "lokalized";

supportedCardinalitiesForLocale("fr").map((form) => form.name);
// => ["CARDINALITY_ONE", "CARDINALITY_MANY", "CARDINALITY_OTHER"]

supportedCardinalitiesForLocale("en").length;   // => 2
supportedCardinalitiesForLocale("ja").map((form) => form.name);   // => ["CARDINALITY_OTHER"]
supportedCardinalitiesForLocale("cy").length;   // => 6
```

French has a third form, and a French catalog that declares only `CARDINALITY_ONE` and
`CARDINALITY_OTHER` — the shape the English example teaches — is incomplete. Nothing about it looks
wrong: it renders correctly for 1 and for 2, which is what anybody tests.

<!-- example: cardinal-forms -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({
  strings: {
    fr: {
      Books: {
        translation: "{{n}} {{b}}",
        placeholders: { b: { value: "n", translations: { CARDINALITY_ONE: "livre", CARDINALITY_OTHER: "livres" } } },
      },
    },
  },
  fallbackLocale: "fr",
  locale: "fr",
});

strings.get("Books", { n: 2 });   // => "2 livres"
```

And then, for a number a test rarely reaches, it returns the key:

<!-- example: cardinal-forms -->

```js
cardinalityForNumber(1000000, "fr").name;   // => "CARDINALITY_MANY"

strings.get("Books", { n: 1000000 });   // => "Books"
```

**The load said so, and the sample above threw the message away.** That is what the `warnings` this
section opened with are for:

<!-- example: cardinal-forms -->

```js
strings.getWarnings().map((warning) => warning.type);
// => ["INCOMPLETE_CARDINALITY_TRANSLATIONS"]

strings.getWarnings()[0].missingLanguageForms;   // => ["CARDINALITY_MANY"]
```

A warning is not a failure and will not stop your process, so nothing forces you to read one. Reading
them at startup and refusing to boot on a non-empty list is the practice this library's own warnings
are shaped for — the message names the file, the key, the placeholder and the missing form.

### Ordinals and ranges are opt-in, and the option has a name

Cardinality data ships on the default path. **Ordinal data and cardinal-range data do not** — they are
separate subpaths so that a page which never renders "3rd" does not download the table that knows how.
A catalog that selects on `ORDINALITY_*`, or uses a `range` placeholder, therefore refuses to
construct until you hand the data in. This is the one place a catalog that needs no configuration at
all in lokalized-java needs some here.

<!-- example: optin -->

```js
import { createStrings } from "lokalized";
import { ordinalData } from "lokalized/data/ordinal";

const catalog = {
  en: {
    Place: {
      translation: "You finished {{p}}.",
      placeholders: { p: { value: "n", translations: {
        ORDINALITY_ONE: "{{n}}st", ORDINALITY_TWO: "{{n}}nd", ORDINALITY_FEW: "{{n}}rd", ORDINALITY_OTHER: "{{n}}th",
      } } },
    },
  },
};

const strings = createStrings({
  strings: catalog,
  fallbackLocale: "en",
  locale: "en",
  pluralData: { ordinal: ordinalData },
});

[1, 2, 3, 4].map((n) => strings.get("Place", { n }));
// => ["You finished 1st.", "You finished 2nd.", "You finished 3rd.", "You finished 4th."]
```

Leave `pluralData` out and construction refuses rather than rendering something wrong — and the
refusal names the option, so this is a minute lost rather than an afternoon:

<!-- example: optin -->

```js
let refusal = "";
try {
  createStrings({ strings: catalog, fallbackLocale: "en", locale: "en" });
} catch (error) {
  refusal = error.message;
}

refusal.includes("pluralData: { ordinal: ordinalData }");   // => true
refusal.includes("lokalized/data/ordinal");   // => true
```

A range placeholder is the other half. It names two value keys instead of one and takes
`pluralData: { ranges: cardinalRangeData }` from `lokalized/data/ranges`:

<!-- example: optin -->

```js
import { cardinalRangeData } from "lokalized/data/ranges";

const stay = createStrings({
  strings: {
    en: {
      Nights: {
        translation: "Your stay is {{r}}.",
        placeholders: { r: { range: { start: "from", end: "to" }, translations: {
          CARDINALITY_ONE: "{{from}}-{{to}} night", CARDINALITY_OTHER: "{{from}}-{{to}} nights",
        } } },
      },
    },
  },
  fallbackLocale: "en",
  locale: "en",
  pluralData: { ranges: cardinalRangeData },
});

stay.get("Nights", { from: 1, to: 3 });   // => "Your stay is 1-3 nights."
```

`getMissingKeys(sourceLocale, targetLocale)` answers the other half: which keys a translator still
owes you.

<!-- example: warnings -->

```js
const bilingual = createStrings({
  strings: { en: { Hello: "Hello", Goodbye: "Goodbye" }, fr: { Hello: "Bonjour" } },
  fallbackLocale: "en",
  locale: "en",
});

bilingual.getMissingKeys("en", "fr");   // => ["Goodbye"]
```

---

## Failure handling

Three things are separately configurable, and they are easy to confuse:

| | |
|---|---|
| `onFailure` | a **function** that decides the final answer when a key cannot be rendered |
| `fallbackPolicy` | whether the walk **keeps looking** in the next candidate locale |
| `onFallback` | an **observer**, told after the fact that a later locale rescued the page |

`RETURN_KEY`, `THROW_EXCEPTION` and `returnString(…)` are the values your handler **returns** — they
are not handlers themselves, and passing one as `onFailure` is a `TypeError`. All three, plus
`MissingTranslationError`, live on `lokalized/core` and **not** on the root:

<!-- example: failure-surface -->

```js
const root = Object.keys(await import("lokalized"));
const core = Object.keys(await import("lokalized/core"));
const names = ["RETURN_KEY", "THROW_EXCEPTION", "returnString", "MissingTranslationError"];

names.filter((name) => root.includes(name));   // => []
names.filter((name) => core.includes(name));
// => ["RETURN_KEY", "THROW_EXCEPTION", "returnString", "MissingTranslationError"]
```

<!-- example: failure -->

```js
import { createStrings } from "lokalized";
import { RETURN_KEY, returnString } from "lokalized/core";

const strings = createStrings({
  strings: { en: { Greeting: "Hello, {{name}}." } },
  fallbackLocale: "en",
  locale: "en",
});

// The default. Note that the KEY is interpolated with the values you passed.
strings.get("Farewell, {{name}}.", { name: "Ada" });
// => "Farewell, Ada."

strings.get("Farewell, {{name}}.", { name: "Ada" }, { onFailure: () => RETURN_KEY });
// => "Farewell, Ada."

// A string you supply comes back verbatim — not interpolated.
strings.get("Farewell, {{name}}.", { name: "Ada" }, { onFailure: () => returnString("[todo: {{name}}]") });
// => "[todo: {{name}}]"
```

### The fallback policy decides whether to keep looking

This is the most surprising behaviour in the library, and it is deliberate: **the default policy
halts on a resolution failure**, forfeiting a translation a later locale could have supplied. A
catalog that is present but cannot render is treated as a defect worth surfacing, not as a gap to
paper over.

<!-- example: policy -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({
  strings: {
    en: { Cart: "Your cart" },
    fr: { Cart: "Votre panier" },
    "fr-CA": {
      Cart: {
        translation: "{{owner}} panier",
        placeholders: {
          owner: { value: "gender", translations: { GENDER_MASCULINE: "Son", GENDER_FEMININE: "Sa" } },
        },
      },
    },
  },
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
  locale: "fr-CA",
});

// Nobody passed `gender`, so the fr-CA entry cannot resolve.
strings.get("Cart", {});                          // => "Cart"
strings.getResult("Cart", {}).failureReason;      // => "resolution-failure"
strings.getResult("Cart", {}).attemptedLocales;   // => ["fr-CA"]

// `fr` holds a perfectly good "Cart". The default policy never asked for it.
strings.get("Cart", {}, { fallbackPolicy: "any-failure" });   // => "Votre panier"
```

A policy can also be a function, which is how you log what was skipped and why:

<!-- example: policy -->

```js
const consulted = [];
const policy = (reason, attemptedLocale, cause) => {
  consulted.push([reason, attemptedLocale, cause.name]);
  return true;
};

strings.get("Cart", {}, { fallbackPolicy: policy });   // => "Votre panier"
consulted;   // => [["resolution-failure", "fr-CA", "ResolutionError"]]
```

### What you would actually write

Install both hooks once at construction and let them feed your logs:

<!-- example: hooks -->

```js
import { createStrings } from "lokalized";

const missing = [];
const fellBack = [];

const strings = createStrings({
  strings: {
    en: { Cart: "Your cart", Checkout: "Check out" },
    fr: { Cart: "Votre panier" },
  },
  fallbackLocale: "en",
  locale: "fr",
  onFailure: (failure) => {
    missing.push([failure.key, failure.lookupLocale, failure.reason]);
    return { action: "return-key" };
  },
  onFallback: (event) => {
    fellBack.push([event.key, event.resolvedLocale, event.precedingFailures.map((f) => f.locale)]);
  },
});

strings.get("Cart");       // => "Votre panier"
strings.get("Checkout");   // => "Check out"
strings.get("Nope");       // => "Nope"

fellBack;   // => [["Checkout", "en", ["fr"]]]
missing;    // => [["Nope", "fr", "missing-translation"]]
```

---

## Limits

Every stage that touches input you did not write is bounded, so a corrupt or hostile catalog fails
closed with a named budget instead of exhausting memory. A loader hands the resolved values back on
the record it returns, so you never have to guess what applied:

<!-- example: limits -->

```js
import { loadStringsFromDirectory } from "lokalized/node";

const loaded = await loadStringsFromDirectory("examples/catalogs", {
  catalogVersion: "2026-09-16",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
});

const limits = loaded.loadingLimits;

limits.maximumInputBytes;              // => 8388608
limits.maximumReaderCharacters;        // => 8388608
limits.maximumJsonNestingDepth;        // => 64
limits.maximumTotalInputBytes;         // => 33554432
limits.maximumLocalizedStringsFiles;   // => 256
limits.maximumTranslationNodes;        // => 100000
limits.maximumWarnings;                // => 1000

Object.keys(limits).length;            // => 7
```

**Four of the seven are budgets for the WHOLE LOAD, not for each file**: `maximumTotalInputBytes`,
`maximumLocalizedStringsFiles`, `maximumTranslationNodes` and `maximumWarnings` accumulate across
every catalog a single load reads. The other three — `maximumInputBytes`, `maximumReaderCharacters`,
`maximumJsonNestingDepth` — bound one file at a time, which is what they are for.

Until recently the manifest-based loaders charged all seven per file, so the same setting meant one
thing through `readStringsFromDirectory` and another through `loadStrings`. **If you load through a
manifest and sit close to a default, that load can now be refused where it used to succeed** — six
locales of two hundred keys each, all of them warning, crosses the default budget of 1,000 warnings
even with no `limits` option set. The directory loader always refused that; now both do. A failure
names the file at which the running total crossed, in the order the files were planned.

**These seven are yours to tighten**, under the option name each door uses — `parseStrings(src,
{ limits })`, `createStrings({ loadingLimits })`, `readStringsFromDirectory(dir, { limits })`,
`loadStrings(manifest, locale, { limits })`. `createStrings` spells it `loadingLimits`, and a
`limits` key there is refused — by a message that names the spelling that works:

<!-- example: limits-name -->

```js
import { createStrings } from "lokalized";

const build = (options) => {
  try {
    createStrings({ strings: { en: { A: "a", B: "b" } }, fallbackLocale: "en", locale: "en", ...options });
    return "constructed";
  } catch (error) {
    return error.message.split(":").pop().trim();
  }
};

// Two translation nodes against a budget of one. Only one of these spellings is read.
build({ loadingLimits: { maximumTranslationNodes: 1 } });
// => "localized strings load exceeds the aggregate maximum of 1 translation nodes"

// The wrong spelling is refused, and the message names the right one rather than just saying no.
// (`hint` trims the surrounding sentence so the line below is the part worth reading.)
const hint = (options) => build(options).replace(/^.*?\. /, "").replace(/\. It takes.*$/, "");

hint({ limits: { maximumTranslationNodes: 1 } });
// => "`limits` is not the option name here; `loadingLimits` is"
```

**And it is a mirror**, which is the part worth remembering: `parseStrings` spells the same concept
`limits`, and refuses `loadingLimits` in the other direction.

<!-- example: limits-name -->

```js
import { parseStrings } from "lokalized/parse";

const parse = (options) => {
  try {
    parseStrings(JSON.stringify({ A: "a", B: "b" }), { locale: "en", ...options });
    return "parsed";
  } catch (error) {
    return error.message.split(":").pop().trim();
  }
};

parse({ limits: { maximumTranslationNodes: 1 } });
// => "localized strings load exceeds the aggregate maximum of 1 translation nodes"

parse({ loadingLimits: { maximumTranslationNodes: 1 } }).replace(/^.*?\. /, "").replace(/\. It takes.*$/, "");
// => "`loadingLimits` is not the option name here; `limits` is"
```

### Every door refuses an option it does not recognise

That is a property of the whole surface, not a quirk of the limits: **every public function that
takes an options object refuses an unknown member** — the per-call options of `get`, `t` and
`getResult` and the locale configuration `createLocaleNegotiator` and the two browser choosers take
included — with a `ConfigurationError` that names the offending key. Where the mistake is one a
reader actually makes, the message also names the spelling that works:

| door | you may reach for | it is | what used to happen instead |
|---|---|---|---|
| `createStrings` | `limits` | `loadingLimits` | construction ran under the defaults |
| `parseStrings`, `readStringsFromDirectory` | `loadingLimits` | `limits` | same, in the other direction |
| `loadStrings`, `loadEntireManifest` | `transport` | `fetch` | **your injected transport was ignored and the load went to the real network** |
| `createStringsManifestFromDirectory` | `baseUrl` | `publicationBaseUrl` | the manifest was published with the source directory's own `file://` path, which the Fetch door then refuses |

The last two are why this changed. Neither failed at the call, so neither looked like a typo: one
produced a network error from a URL you never typed, the other produced a manifest that validated,
fingerprinted identically to the correct one, and was refused much later somewhere else.

The ones you are likeliest to meet day to day are a misspelled configuration member, which the
negotiator used to ignore while it ran on the one you spelled right; the values bag handed in the
options slot, which used to return the key with no error; something that is not an options object at
all where the options go, which used to be ignored — a transport handed over bare went to the real
network, and so did an options object from an async function whose `await` was forgotten; and a
misspelled member of a language range:

<!-- example: unknown-members -->

```js
import { createStrings } from "lokalized";
import { createLocaleNegotiator } from "lokalized/negotiate";

const refusal = (run) => {
  try {
    run();
    return "accepted";
  } catch (error) {
    return error.message.replace(/\. It takes.*$/, "");
  }
};

refusal(() => createLocaleNegotiator({ supportedLocales: ["en", "fr"], fallbackLocale: "en", fallbackLocal: "fr" }));
// => "createLocaleNegotiator does not take the option(s) [fallbackLocal]"

const strings = createStrings({ strings: { en: { Items: "{{count}} items" } }, fallbackLocale: "en", locale: "en" });

strings.get("Items", { count: 3 });   // => "3 items"
refusal(() => strings.get("Items", undefined, { count: 3 }));
// => "get does not take the option(s) [count]"

// `undefined`, `null` and `false` mean "no options", so `cond && { locale }` still works in
// JavaScript. (TypeScript refuses `false` and `null` there: the declared types take an options
// object or nothing.)
// Anything else that is not an object is refused, and so is a promise: an unawaited one has no keys
// of its own, so it used to read as "no options".
strings.get("Items", { count: 3 }, false);   // => "3 items"
refusal(() => strings.get("Items", { count: 3 }, "fr"));
// => "get takes an options object, and was handed the string \"fr\""
refusal(() => strings.get("Items", { count: 3 }, Promise.resolve({ locale: "fr" })));
// => "get takes an options object, and was handed a promise; await it first"

// A language range takes `range` and `weight` and nothing else. The misspelled weight used to be
// read as absent — as 1.0 — so this list, written to exclude French, selected it.
const negotiator = createLocaleNegotiator({ supportedLocales: ["en", "fr"], fallbackLocale: "en" });
refusal(() => negotiator.bestMatchForLanguageRanges([{ range: "fr", wieght: 0 }, { range: "en", weight: 0.5 }]));
// => "A language range takes only 'range' and 'weight', and this one also has [wieght]"
```

The rule reaches one kind of value you build that is not an options object: the language ranges you
hand the range-list doors (`matchForLanguageRanges`, `bestMatchForLanguageRanges`,
`forLanguageRanges`), as the last line above shows. It does not reach two others. A value the library
hands you and you hand back — a manifest, a `LocaleMatch`, an SSR stamp or rendering context — is a
record rather than an options object, and is not held to this rule. And the placeholder values you
pass to `get` are named by your catalog, so there is no list to refuse a misspelling against. A value
under the wrong name is ignored; the placeholder it was meant for then fails as missing, which by
default hands back the key, and a value no translation references is never noticed at all.

The refusal recurses one level into `limits`, which is the other place a name can be dropped — an
unknown budget is refused, and so is a container the seven budgets cannot be read out of. A
`ReadonlyMap` is the one to know about: `tiebreakers` accepts one and `limits` does not, so the same
budget spelled as a Map used to be dropped in silence while the plain object refused.

**A key present with an `undefined` value is still refused.** `{ transport: maybeUndefined }` is the
same misspelling as `{ transport: fn }`, and a value-sensitive rule would let the dangerous case through on
exactly the days the value happened to be unset. If you spread a wider config object into a door, spread
the members it takes.

`maximumInputBytes` and `maximumReaderCharacters` are two doors rather than two names for one budget.
A byte cap is inert on string input and a character cap is inert on byte input.

**The render-time limits are fixed in v1 and refuse to be configured**, including an explicit `null`
— every other nullable option treats `null` as "unset", and this one does not:

<!-- example: limits -->

```js
import { createStrings } from "lokalized";

const refusal = (runtimeLimits) => {
  try {
    createStrings({ strings: { en: { Hi: "Hello" } }, fallbackLocale: "en", locale: "en", runtimeLimits });
    return "accepted";
  } catch (error) {
    return error.constructor.name;
  }
};

refusal({});      // => "RangeError"
refusal(null);    // => "RangeError"
refusal(undefined);   // => "accepted"
```

---

## Right-to-left text, `lang` and `dir`

The library's entire bidirectional-text mechanism is this: **it wraps the values you interpolate in
U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE**, so a Latin name dropped into an
Arabic sentence cannot drag the surrounding punctuation around with it. Nothing inspects the value's
own direction — the decision is made from the locale.

<!-- example: rtl-isolation -->

```js
import { createStrings } from "lokalized";

const arabic = createStrings({
  strings: { ar: { Greeting: "مرحبا {{name}}" } },
  fallbackLocale: "ar",
  locale: "ar",
});

const greeting = arabic.get("Greeting", { name: "Sarah" });

greeting;   // => "مرحبا ⁨Sarah⁩"
[...greeting].map((c) => c.codePointAt(0).toString(16)).slice(-7);
// => ["2068", "53", "61", "72", "61", "68", "2069"]

// Nothing inspects the VALUE's direction — an Arabic name in an English catalog is inserted bare.
const english = createStrings({
  strings: { en: { Greeting: "Hello {{name}}" } },
  fallbackLocale: "en",
  locale: "en",
});

english.get("Greeting", { name: "أحمد" });   // => "Hello أحمد"
```

There are three modes and the default is `"rtl-locales"` — isolation is on out of the box, and only
for locales written right to left:

<!-- example: rtl-modes -->

```js
import { createStrings } from "lokalized";

const catalogs = { en: { Hi: "Hello {{name}}" }, ar: { Hi: "مرحبا {{name}}" } };
const build = (bidiIsolation) =>
  createStrings({ strings: catalogs, fallbackLocale: "en", locale: "en", bidiIsolation });

build(undefined).get("Hi", { name: "Sarah" }, { locale: "en" });   // => "Hello Sarah"
build(undefined).get("Hi", { name: "Sarah" }, { locale: "ar" });   // => "مرحبا ⁨Sarah⁩"

build("all").get("Hi", { name: "Sarah" }, { locale: "en" });    // => "Hello ⁨Sarah⁩"
build("none").get("Hi", { name: "Sarah" }, { locale: "ar" });   // => "مرحبا Sarah"

// A per-call mode REPLACES the instance mode, in both directions.
build("none").get("Hi", { name: "S" }, { locale: "en", bidiIsolation: "all" });    // => "Hello ⁨S⁩"
build("all").get("Hi", { name: "S" }, { locale: "ar", bidiIsolation: "none" });    // => "مرحبا S"

// But a per-call `null` means UNSET and inherits the INSTANCE mode — it does not reset to default.
build("all").get("Hi", { name: "S" }, { locale: "en", bidiIsolation: null });         // => "Hello ⁨S⁩"
build("none").get("Hi", { name: "S" }, { locale: "ar", bidiIsolation: undefined });   // => "مرحبا S"
```

### The locale that decides is the one that supplied the text

Not the one you asked for. This is the same rule that governs plural selection — the evaluation
locale is the **donor catalog's** — and it has a visible consequence here:

<!-- example: rtl-donor -->

```js
import { createStrings } from "lokalized";

// Requested `en`, supplied by the Arabic catalog: isolated.
const arabicFallback = createStrings({
  strings: { ar: { Hi: "مرحبا {{name}}" }, en: { Other: "thing" } },
  fallbackLocale: "ar",
  locale: "ar",
});

arabicFallback.get("Hi", { name: "Sarah" }, { locale: "en" });                        // => "مرحبا ⁨Sarah⁩"
arabicFallback.getResult("Hi", { name: "Sarah" }, { locale: "en" }).resolvedLocale;   // => "ar"

// Requested `ar`, supplied by the English catalog: NOT isolated.
const englishFallback = createStrings({
  strings: { en: { Hi: "Hello {{name}}" }, ar: { Other: "شيء" } },
  fallbackLocale: "en",
  locale: "en",
});

englishFallback.get("Hi", { name: "Sarah" }, { locale: "ar" });                        // => "Hello Sarah"
englishFallback.getResult("Hi", { name: "Sarah" }, { locale: "ar" }).resolvedLocale;   // => "en"

// The one exception: a returned key had no donor, so the REQUESTED locale decides.
englishFallback.get("No {{name}} here", { name: "Sarah" }, { locale: "ar" });   // => "No ⁨Sarah⁩ here"
englishFallback.get("No {{name}} here", { name: "Sarah" }, { locale: "en" });   // => "No Sarah here"
```

The direction itself comes from **pinned CLDR data**, not from the host — the same reason plural
rules do. An explicit script subtag short-circuits the lookup in both directions, including CLDR's
unknown-script placeholder `Zzzz`, which is an explicit script and is not right-to-left:

<!-- example: rtl-script -->

```js
import { createStrings } from "lokalized";

const probe = createStrings({ strings: { en: { A: "a" } }, fallbackLocale: "en", locale: "en" });
const isolates = (tag) => probe.get("? {{v}} ?", { v: "x" }, { locale: tag }).includes("⁨");

["ar", "he", "fa", "ur", "yi", "ps", "dv", "ckb"].every(isolates);   // => true
["en", "fr", "ja", "az", "ku", "ha"].some(isolates);                 // => false

isolates("ar-Latn");   // => false
isolates("en-Arab");   // => true

[isolates("ar"), isolates("ar-Zzzz"), isolates("und")];   // => [true, false, false]
```

### Isolation rewrites the value, and can delete a character

This surprises people writing snapshot or round-trip tests. The wrapper has to produce a
well-formed isolate run, so a value carrying stray directional marks is repaired as it is wrapped:

<!-- example: rtl-repair -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({ strings: { ar: { V: "{{v}}" } }, fallbackLocale: "ar", locale: "ar" });
const isolate = (value) => strings.get("V", { v: value });

// A value that is already one balanced isolate run is returned untouched.
isolate("⁨Sarah⁩");   // => "⁨Sarah⁩"

// An unmatched POP DIRECTIONAL ISOLATE would pop the wrapper, so it is DROPPED — this deletes a
// character from your data.
isolate("Sa⁩rah");   // => "⁨Sarah⁩"

// An unclosed initiator is balanced; a run that closes early is wrapped again.
isolate("⁨Sarah");    // => "⁨⁨Sarah⁩⁩"
isolate("⁨a⁩b");   // => "⁨⁨a⁩b⁩"

// The empty string gets no marks; non-strings are coerced and then wrapped.
isolate("");                     // => ""
[isolate(3), isolate(true)];     // => ["⁨3⁩", "⁨true⁩"]

// And it costs exactly two code units, which matters if you measure or truncate the result.
isolate("Sarah").length - "Sarah".length;   // => 2
```

### `lang` and `dir` are yours — and `lang` is per key

There is **no direction API in the public surface**, on any subpath. `dir` is entirely the
application's to compute:

<!-- example: rtl-no-direction-api -->

```js
const subpaths = [
  "lokalized", "lokalized/core", "lokalized/parse", "lokalized/load", "lokalized/ssr",
  "lokalized/negotiate", "lokalized/node", "lokalized/data/ordinal", "lokalized/data/ranges",
];

const names = [];
for (const subpath of subpaths) names.push(...Object.keys(await import(subpath)));

names.length > 100;   // => true
names.filter((name) => /dir|rtl|bidi|direction|isolat/i.test(name)).sort();
// => ["createStringsManifestFromDirectory", "loadStringsFromDirectory", "readStringsFromDirectory"]
```

The host's `Intl` is the obvious source, and the `try`/`catch` is **not** decoration — this library
accepts and hands back tags that `Intl.Locale` refuses:

<!-- example: rtl-dir -->

```js
import { createStrings } from "lokalized";

function directionFor(tag) {
  try {
    const locale = new Intl.Locale(tag);
    const info = typeof locale.getTextInfo === "function" ? locale.getTextInfo() : locale.textInfo;
    return info.direction === "rtl" ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}

[directionFor("ar"), directionFor("he-IL"), directionFor("ar-Latn"), directionFor("en-US")];
// => ["rtl", "rtl", "ltr", "ltr"]

const strings = createStrings({
  strings: { "x-private": { K: "V" }, en: { K: "E" } },
  fallbackLocale: "en",
  locale: "x-private",
});

strings.getResult("K").resolvedLocale;   // => "x-private"
(() => { try { new Intl.Locale("x-private"); return "ok"; } catch { return "RangeError"; } })();   // => "RangeError"
```

`getResult` reports **three** locale-shaped fields and they are three different things. The one that
describes the bytes you are about to put in the DOM is `resolvedLocale` — and it is decided **per
key**, so a single page-level `lang` is an approximation:

<!-- example: rtl-lang -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({
  strings: {
    he: { Welcome: "ברוך הבא, {{name}}" },
    en: { Welcome: "Welcome, {{name}}", "Legal.Terms": "Terms apply to {{name}}" },
  },
  fallbackLocale: "en",
  locale: "he",
});

const welcome = strings.getResult("Welcome", { name: "Sarah" });
const terms = strings.getResult("Legal.Terms", { name: "Sarah" });

// One instance, one requested locale, two keys — and two supplying locales.
welcome.lookupLocale;     // => "he"
welcome.resolvedLocale;   // => "he"
terms.resolvedLocale;     // => "en"
terms.attemptedLocales;   // => ["he", "en"]

// It is `null` whenever nothing supplied the text, so an unguarded binding emits lang="".
const missing = strings.getResult("No.Such.Key", { name: "Sarah" });

missing.status;           // => "returned-key"
missing.failureReason;    // => "missing-translation"
missing.resolvedLocale;   // => null
```

And `isFallback` is **not** the "this text is in the wrong language" signal a markup author wants. It
is true when *either* negotiation or per-key resolution fell back, so it is false for text served
correctly in Hebrew and true for a returned key that is in no language at all:

<!-- example: rtl-lang -->

```js
[welcome.resolvedLocale, welcome.isFallback];   // => ["he", false]
[terms.resolvedLocale, terms.isFallback];       // => ["en", true]
[missing.resolvedLocale, missing.isFallback];   // => [null, false]
```

### It escapes nothing, and it does not localize digits

The library returns text. Markup a translator wrote and markup a user supplied both pass through
verbatim, and isolation *wraps* injected markup rather than defusing it:

<!-- example: rtl-escaping -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({
  strings: {
    en: { Bold: "Read <strong>{{title}}</strong>.", Plain: "Hello, {{name}}.", N: "{{n}}" },
    he: { Plain: "שלום, {{name}}.", N: "{{n}}" },
  },
  fallbackLocale: "en",
  locale: "en",
});

strings.get("Bold", { title: "Dune" });                 // => "Read <strong>Dune</strong>."
strings.get("Plain", { name: "<script>x</script>" });   // => "Hello, <script>x</script>."

// Escape at the output boundary. The isolate marks are not in the escaped set, so they survive.
const rendered = strings.get("Plain", { name: "<b>x</b>" }, { locale: "he" });
const escapeHtml = (text) => text.replace(/[&<>"']/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

rendered;               // => "שלום, ⁨<b>x</b>⁩."
escapeHtml(rendered);   // => "שלום, ⁨&lt;b&gt;x&lt;/b&gt;⁩."

// Numbers go through `String()`. No digit shaping, no grouping separator, in any locale.
const digits = (tag) => strings.get("N", { n: 1234567 }, { locale: tag }).replace(/[⁦-⁩]/gu, "");

[digits("en"), digits("he")];   // => ["1234567", "1234567"]
```

Number formatting for a reader of Arabic or Persian is yours to do, with the host's
`Intl.NumberFormat` or whatever you already use. The library will not reach for it, because reaching
for the host is what makes two machines disagree.

---

### Accessibility, and where this library's part ends

Most of what this library offers an accessibility-conscious page is above, under headings that do
not say the word: `lang` is **per key**, because the locale that supplied the text is not always the
one you asked for; `dir` is yours to compute and there is deliberately no API for it; and
interpolated values are wrapped in isolates so a right-to-left sentence does not reorder an
identifier. This section exists so that a reader searching for the word finds them, and so the
boundary is stated rather than inferred.

**Everything else is yours, and the surface says so rather than the prose:**

<!-- example: a11y -->

```js
const subpaths = [
  "lokalized", "lokalized/core", "lokalized/parse", "lokalized/load", "lokalized/ssr",
  "lokalized/negotiate", "lokalized/node", "lokalized/data/ordinal", "lokalized/data/ranges",
];
const names = [];
for (const subpath of subpaths) names.push(...Object.keys(await import(subpath)));

names.filter((name) => /aria|role|focus|announce|live|label/i.test(name));   // => []
names.filter((name) => /format|escape|sanitiz|html/i.test(name));   // => []
```

No ARIA attribute, no live-region announcement, no focus management, no date or number formatting,
and no markup of any kind — it returns a string and never touches your DOM. It does not set `lang`
either; it tells you what to set it to.

**The one thing worth knowing that is not obvious: the isolate characters travel with the string.**
They are invisible, they are part of the value, and they reach wherever you put it — an `aria-label`,
a `document.title`, a `<title>`, a cache key, an analytics event:

<!-- example: a11y -->

```js
import { createStrings } from "lokalized";

const strings = createStrings({ strings: { ar: { M: "س {{v}}" } }, fallbackLocale: "ar", locale: "ar" });
const rendered = strings.get("M", { v: "AB" });

rendered.length;                  // => 6
[...rendered].length - 2;         // => 4
rendered === "س AB";              // => false
rendered.includes("س AB");        // => false
rendered.replace(/[\u2066-\u2069]/g, "") === "س AB";   // => true
```

That is correct for anything a browser lays out, and it is a trap for anything that compares,
truncates or hashes. **Strip the isolates for comparison, never for display** — removing them from
what a user sees is the reordering bug they exist to prevent. What a screen reader announces for
these characters is the reader's business and is not something this document has measured.

## One instance, many requests

A `Strings` instance is frozen and holds no request state, so a server builds **one** and keeps it.
The locale is a per-call decision, and the mistake worth seeing before you write it is the obvious
alternative — a module-level variable holding "the current locale":

<!-- example: fw-global -->

```js
import { createStrings, forLocale } from "lokalized/core";

const strings = createStrings({
  strings: { en: { Hi: "Hi" }, fr: { Hi: "Salut" }, ja: { Hi: "Konnichiwa" } },
  fallbackLocale: "en",
  locale: "en",
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let current = forLocale("en");
const render = async (tag, delay) => {
  current = forLocale(tag);
  await sleep(delay);
  return strings.get("Hi", undefined, current);
};

// Every concurrent request gets the LAST locale set, and nothing throws.
await Promise.all([render("en", 30), render("fr", 5), render("ja", 1)]);
// => ["Konnichiwa", "Konnichiwa", "Konnichiwa"]
```

Pass the locale per call instead. When threading it through a component tree is the problem,
`localeResolver` is a door that reads it from wherever your request context lives — it is called with
no arguments, once per lookup:

<!-- example: fw-ambient -->

```js
import { AsyncLocalStorage } from "node:async_hooks";
import { createStrings, forLocale } from "lokalized/core";

const requestLocale = new AsyncLocalStorage();
let resolverCalls = 0;

const strings = createStrings({
  strings: { en: { Hi: "Hi" }, fr: { Hi: "Salut" }, ja: { Hi: "Konnichiwa" } },
  fallbackLocale: "en",
  localeResolver: () => { resolverCalls += 1; return requestLocale.getStore() ?? "en"; },
});

resolverCalls;   // => 0

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const Title = () => strings.get("Hi");
const Page = async (delay) => { await sleep(delay); const first = Title(); await sleep(delay); return [first, Title()]; };

// Nothing below passes a locale, options, or `strings`. Four overlapping requests, out of order.
await Promise.all([["fr", 30], ["ja", 5], ["en", 1], ["fr", 20]].map(([tag, delay]) => requestLocale.run(tag, () => Page(delay))));
// => [["Salut", "Salut"], ["Konnichiwa", "Konnichiwa"], ["Hi", "Hi"], ["Salut", "Salut"]]

// Once per lookup — never at construction, never for inspection, and skipped by a per-call locale.
resolverCalls;                                   // => 8
strings.getSupportedLocales();                   // => ["en", "fr", "ja"]
strings.get("Hi", undefined, forLocale("ja"));   // => "Konnichiwa"
resolverCalls;                                   // => 8
```

`AsyncLocalStorage` is Node's; the door is not. `localeResolver` is just a function you supply, so
any per-request context works — and `createStrings` requires **exactly one** of the three locale
doors, so there is no precedence rule to remember:

<!-- example: fw-ambient -->

```js
const catalogs = { strings: { en: { Hi: "Hi" }, fr: { Hi: "Salut" } }, fallbackLocale: "en" };
const doors = (options) => {
  try {
    createStrings({ ...catalogs, ...options });
    return "constructed";
  } catch (error) {
    return error.message.split("; ").pop();
  }
};

doors({ locale: "fr" });                        // => "constructed"
doors({ localeResolver: () => "fr" });          // => "constructed"
doors({});                                      // => "received none"
doors({ locale: "fr", localeResolver: () => "fr" });   // => "received [locale, localeResolver]"
```

Reusing one instance is also the cheap shape. On a 300-key, four-locale fixture rendering a 20-key
page, rebuilding per request measured **2.28 ms**, a shared instance with `forLocale(tag)` on each
`get` **0.53 ms**, and a shared instance reusing the negotiated match through `forLocaleMatch`
**0.10 ms** — all three producing byte-identical output. Those are one machine's numbers, not a
promise; the ratio is the point.

### What crosses a boundary

The instance does not. The **record** does, and that is the entire hand-off:

<!-- example: fw-wire -->

```js
import { createStrings } from "lokalized/core";
import { createStringsManifestFromDirectory, loadEntireManifestFromFiles } from "lokalized/node";

const manifest = await createStringsManifestFromDirectory("examples/catalogs", {
  catalogVersion: "2026.09.15",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
});
const loaded = await loadEntireManifestFromFiles(manifest);
const server = createStrings({ loaded, locale: "fr-CA" });

// JSON empties the instance silently; `structuredClone` refuses outright.
JSON.stringify(server);       // => "{}"
JSON.stringify({ server });   // => "{\"server\":{}}"

const cloneFailure = (value) => { try { structuredClone(value); return null; } catch (error) { return error.name; } };

cloneFailure(server);               // => "DataCloneError"
cloneFailure({ nested: server });   // => "DataCloneError"

// The record survives both algorithms and still works.
const client = createStrings({ loaded: JSON.parse(JSON.stringify(loaded)), locale: "fr-CA" });

client.get("Cart.Items", { count: 2 });   // => "Votre panier compte 2 livres."
client.isCatalogComplete();               // => true
client.getCatalogIdentity().catalogFingerprint === loaded.catalogIdentity.catalogFingerprint;   // => true

// A record loaded off disk NAMES THE DISK, in two places per catalog.
loaded.catalogs.en.sources[0].startsWith("file:///");   // => true
loaded.requestedFiles[0].url.startsWith("file:///");    // => true
```

Those last two lines are the one to watch: **serializing a Node-file-door record into a page ships
your server's absolute paths to every visitor.** That is a property of the door, not of the record
type — the same catalogs loaded through the Fetch door carry only the public origin:

<!-- example: fw-origin -->

```js
import { readFileSync } from "node:fs";
import { createStrings } from "lokalized/core";
import { loadStrings } from "lokalized/load";
import { createStringsManifestFromDirectory } from "lokalized/node";

const published = await createStringsManifestFromDirectory("examples/catalogs", {
  catalogVersion: "2026.09.15",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
  publicationBaseUrl: "https://cdn.example.com/i18n/",
});

const transport = async (url) => new Response(readFileSync(`examples/catalogs/${String(url).split("/").pop()}`));
const loaded = await loadStrings(published, "fr", { fetch: transport });

loaded.catalogs.fr.sources;                     // => ["https://cdn.example.com/i18n/fr.json"]
JSON.stringify(loaded).includes("file://");     // => false
createStrings({ loaded: JSON.parse(JSON.stringify(loaded)), locale: "fr" }).get("App.Title");
// => "La librairie Lokalized"
```

The record also survives `structuredClone`, which is the worker hand-off — but it is **not
deep-equal to its own round trip**, because the catalogs are null-prototype and frozen and both
algorithms rebuild them as ordinary objects:

<!-- example: fw-wire -->

```js
import { isDeepStrictEqual } from "node:util";

Object.getPrototypeOf(loaded.catalogs) === null;   // => true
Object.isFrozen(loaded);                           // => true

const roundTrip = JSON.parse(JSON.stringify(loaded));

Object.getPrototypeOf(roundTrip.catalogs) === Object.prototype;   // => true
isDeepStrictEqual(roundTrip, loaded);                             // => false

// Compare the fingerprint, or compare rendered output — not the records themselves.
roundTrip.catalogIdentity.catalogFingerprint === loaded.catalogIdentity.catalogFingerprint;   // => true
```

### The door decides which locales the instance will serve

Two records over the same manifest, differing only in which loader produced them, give instances that
answer differently — and a lookup subset refuses a tag whose catalog it is physically holding:

<!-- example: fw-subset -->

```js
import { createStrings, forLocale } from "lokalized/core";
import { createStringsManifestFromDirectory, loadStringsFromFiles, loadEntireManifestFromFiles } from "lokalized/node";

const manifest = await createStringsManifestFromDirectory("examples/catalogs", {
  catalogVersion: "2026.09.15",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
});

const asked = (instance, tag) => {
  try {
    return instance.get("App.Title", undefined, forLocale(tag));
  } catch (error) {
    return error.message.split(". ")[0];
  }
};

const frOnly = createStrings({ loaded: await loadStringsFromFiles(manifest, "fr"), locale: "fr" });

frOnly.getSupportedLocales();   // => ["en", "fr", "fr-CA"]
asked(frOnly, "fr");            // => "La librairie Lokalized"
asked(frOnly, "fr-CA");
// => "This Strings was loaded for lookup 'fr' only, and this lookup starts from 'fr-CA'"

// Two lists, answering two different questions: what was LOADED, and what the manifest DECLARES.
frOnly.getLocaleConfiguration().supportedLocales;   // => ["en", "es", "fr", "fr-CA"]

// The whole manifest answers for every locale, per call, and falls back for one it never had.
const everything = createStrings({ loaded: await loadEntireManifestFromFiles(manifest), locale: "en" });

["en", "fr", "fr-CA", "es"].map((tag) => asked(everything, tag));
// => ["The Lokalized Bookshop", "La librairie Lokalized", "La librairie Lokalized du Canada", "La libreria Lokalized"]
asked(everything, "de");   // => "The Lokalized Bookshop"
```

Build a language switcher from `getLocaleConfiguration().supportedLocales` and you offer locales this
instance cannot serve; build it from `getSupportedLocales()` and you hide ones you could fetch. Which
is right depends on whether you can load more on demand.

### Errors lose different halves on the way across

<!-- example: fw-errors -->

```js
import { createStrings, LokalizedError } from "lokalized/core";

const strings = createStrings({ strings: { en: { K: "Hello" } }, fallbackLocale: "en", locale: "en" });

let thrown;
try { strings.getKeysForLocale("de"); } catch (error) { thrown = error; }

// The control: unserialized, both the class check and the code work.
thrown instanceof LokalizedError;   // => true
thrown.code;                        // => "UNSUPPORTED_LOCALE"

// JSON keeps the enumerable own fields and loses `message`, which is not enumerable.
const asJson = JSON.parse(JSON.stringify(thrown));

Object.keys(asJson);   // => ["code", "name", "locale"]
asJson.message;        // => undefined

// `structuredClone` keeps the message and loses the class and the code.
const asClone = structuredClone(thrown);

asClone.message;                     // => "Unsupported locale 'de' was provided"
asClone.constructor.name;            // => "Error"
asClone instanceof LokalizedError;   // => false
asClone.code;                        // => undefined

// `name` is the only discriminator both algorithms carry.
[asJson.name, asClone.name];   // => ["UnsupportedLocaleError", "Error"]
```

---

## Server rendering and the client hand-off

Rendering on the server and picking the page up on the client means two builds have to agree. A
different library version, different pinned CLDR data, or a catalog that changed between the render
and the hydration, and the wording shifts under the reader — silently, because nothing throws when
two builds merely *disagree*.

`lokalized/ssr` exports two functions and nothing else. The server builds a **stamp**: a small JSON
object naming the library build, the pinned data, the catalog bytes, and the locale this render
selected. Embed it in the page; the client rebuilds its own `Strings`, presents the stamp, and
`validateSsrStamp` throws unless all of that agrees.

<!-- example: ssr -->

```js
import { createStrings } from "lokalized/core";
import { loadStringsFromDirectory } from "lokalized/node";
import { createSsrStamp, validateSsrStamp } from "lokalized/ssr";

Object.keys(await import("lokalized/ssr"));   // => ["createSsrStamp", "validateSsrStamp"]

const loaded = await loadStringsFromDirectory("examples/catalogs", {
  catalogVersion: "2026.09.15",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
});

const strings = createStrings({ loaded, locale: "en" });
const stamp = createSsrStamp(strings, { kind: "locale", locale: "fr-CA" });

Object.keys(stamp);
// => ["formatVersion", "producerImplementation", "producerVersion", "catalogVersion", "catalogFingerprint", "cldrVersion", "dataFingerprint", "ianaRegistryDate", "ianaDataFingerprint", "behavioralVectorsVersion", "localeDataMode", "cardinalityMode", "lookupLocale", "localeMatch"]

stamp.lookupLocale;     // => "fr-CA"
stamp.localeMatch;      // => { locale: "fr-CA", matchType: "exact" }
stamp.localeDataMode;   // => "pinned"

// The File-Date of the pinned IANA registry snapshot — see the end of this section.
/^\d{4}-\d{2}-\d{2}$/.test(stamp.ianaRegistryDate);   // => true
```

Everything up to `cardinalityMode` is build and data identity — the same for every render of a given
deployment. `lookupLocale` and `localeMatch` are what *this* render decided.

It crosses the wire as plain JSON, and validation signals only by throwing:

<!-- example: ssr -->

```js
const wire = JSON.parse(JSON.stringify(stamp));
const at = (locale) => ({ kind: "locale", locale });

wire.localeMatch;                          // => { locale: "fr-CA", matchType: "exact" }
validateSsrStamp(wire, strings, at("fr-CA"));   // => undefined
```

**`validateSsrStamp` returns `undefined`.** There is no boolean and no report object, so
`if (validateSsrStamp(…))` is a hydration that never happens.

### What it refuses

<!-- example: ssr -->

```js
const refusal = (presented, context) => {
  try {
    validateSsrStamp(presented, strings, context);
    return null;
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
};

refusal(wire, at("fr-CA"));   // => null

refusal({ ...wire, catalogFingerprint: "0".repeat(64) }, at("fr-CA")).split(" is ")[0];
// => "ConfigurationError: Stamp field 'catalogFingerprint'"

refusal(wire, at("fr")).split(" is ")[0];
// => "ConfigurationError: Stamp field 'lookupLocale'"

refusal({ ...wire, producerVersion: `${wire.producerVersion}-other` }, at("fr-CA")).split(" is ")[0];
// => "ConfigurationError: Stamp field 'producerVersion'"

refusal({ ...wire, renderedAt: 1 }, at("fr-CA"));
// => "ConfigurationError: This stamp carries an unknown field 'renderedAt'"

refusal({ ...wire, localeDataMode: "host-intl" }, at("fr-CA")).split(";")[0];
// => "ConfigurationError: Strict hydration accepts only pinned locale data with exact cardinality"
```

The last one is the data-mismatch case, and it is refused before any field is compared: strict
hydration accepts only pinned locale data with exact cardinality. A client that classified plurals
from the host cannot be checked against a server that classified them from the pinned tables, so the
advice in the message is to render on the client or navigate — not to hydrate and hope.

### Only a verified load can be stamped

<!-- example: ssr -->

```js
const direct = createStrings({ strings: { en: { Hi: "Hello" } }, fallbackLocale: "en", locale: "en" });

direct.getLoadVerification();   // => null

const stampError = (instance, context) => {
  try {
    createSsrStamp(instance, context);
    return null;
  } catch (error) {
    return error.message.split(". ")[0];
  }
};

stampError(strings, at("fr-CA"));   // => null
stampError(direct, at("en"));
// => "This Strings instance was constructed directly, so there is no verified manifest load to stamp"
```

This is the refusal most people meet first, because the smallest possible example is a direct
`createStrings`. Two near misses are refused for the same reason — an instance that *claims* an
identity, and a load that gave up on one of its catalogs. Both render perfectly well; neither is a
thing another build can be checked against.

<!-- example: ssr-ineligible -->

```js
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStrings } from "lokalized/core";
import { createStringsManifestFromDirectory, loadEntireManifestFromFiles } from "lokalized/node";
import { createSsrStamp } from "lokalized/ssr";

const refused = (instance) => {
  try {
    createSsrStamp(instance, { kind: "locale", locale: "fr" });
    return null;
  } catch (error) {
    return error.message.split(". ")[0];
  }
};

// Core validates an identity's SHAPE, never its truth, so claiming one changes nothing.
const claimed = createStrings({
  strings: { en: { Hi: "Hello" }, fr: { Hi: "Bonjour" } },
  fallbackLocale: "en",
  locale: "en",
  catalogIdentity: { catalogVersion: "2026.09.15", catalogFingerprint: "a".repeat(64) },
});

claimed.getCatalogIdentity().catalogVersion;   // => "2026.09.15"
claimed.getLoadVerification();                 // => null
refused(claimed);
// => "This Strings instance was constructed directly, so there is no verified manifest load to stamp"

// And a partial load renders, but there is no complete catalog set to identify.
const directory = mkdtempSync(join(tmpdir(), "lokalized-"));
cpSync("examples/catalogs", directory, { recursive: true });

const manifest = await createStringsManifestFromDirectory(directory, {
  catalogVersion: "2026.09.15",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
});

rmSync(join(directory, "es.json"));
const partial = await loadEntireManifestFromFiles(manifest, { partialFailure: "allow-partial" });
const incomplete = createStrings({ loaded: partial, locale: "fr" });

partial.complete;                 // => false
incomplete.get("App.Title");      // => "La librairie Lokalized"
refused(incomplete);
// => "This load is incomplete (complete: false), so it cannot be stamped for hydration"

rmSync(directory, { recursive: true });
```

### The server loads everything; the client loads one locale

<!-- example: ssr -->

```js
import { createStringsManifestFromDirectory, loadStringsFromFiles } from "lokalized/node";
import { fetchSet } from "lokalized/load";

const manifest = await createStringsManifestFromDirectory("examples/catalogs", {
  catalogVersion: "2026.09.15",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
});

// This is the client's fetch plan — and what your `<link rel="preload">` tags should name.
fetchSet(manifest, "fr-CA").map((entry) => entry.locale);   // => ["fr-CA", "fr", "en"]

const subset = await loadStringsFromFiles(manifest, "fr-CA");
const client = createStrings({ loaded: subset, locale: "fr-CA" });

subset.coverage;                // => { kind: "lookup", lookupLocale: "fr-CA" }
Object.keys(subset.catalogs);   // => ["fr-CA", "fr", "en"]

// A subset of the catalogs, and the same identity — which is what makes the hand-off work.
subset.catalogIdentity.catalogFingerprint === stamp.catalogFingerprint;   // => true
validateSsrStamp(wire, client, at("fr-CA"));                              // => undefined
```

A lookup subset is pinned to the locale it was planned for, and the stamp holds it there:

<!-- example: ssr -->

```js
const clientRefusal = (context) => {
  try {
    validateSsrStamp(wire, client, context);
    return null;
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
};

clientRefusal(at("fr"));
// => "ConfigurationError: This load covers lookup 'fr-CA' only, and the rendering context is 'fr'"

clientRefusal(at("es"));
// => "ConfigurationError: A selected locale must occur in the instance's applicable configuration; 'es' does not"
```

Both refusals are worth reading. `fr` is one of the three catalogs this client actually fetched and
is still refused, because a subset is planned for one lookup locale rather than for a set. `es` is
refused by a *different* check, because a subset client's two inventories disagree on purpose:
`getLocaleConfiguration().supportedLocales` is the whole manifest, so the client can still negotiate
against locales it did not download, while `getSupportedLocales()` is what arrived.

### What a stamp is not

- **Not a cache key.** It projects the match down to `{ locale, matchType }`, and two visitors can
  agree on both of those and still be owed different pages — that is the whole of the next section.
- **Not a signature.** There is no secret and no signing. It catches drift between two builds, not
  someone editing your HTML.
- **Not a way to skip fetching catalogs.** It carries no URLs and no translations. What it buys is
  *reuse*: a client already holding a `LoadedStrings` can compare its
  `catalogIdentity.catalogFingerprint` against the stamp before doing any network work at all.
- **Not a promise of identical HTML.** It covers the build, the data, the catalog bytes and the
  locale selection. It does not hash your placeholders, your per-call options, or the callbacks you
  injected.
- **Not portable across builds.** `producerVersion` and `producerImplementation` are compared
  exactly; a client on a different release of this library is refused rather than reconciled.

And `ianaRegistryDate` **is** the `File-Date` of the pinned IANA Language Subtag Registry snapshot
this build was published against. It is provenance, not the data: two deployments could share a
File-Date and still carry different language-range behaviour, which is what `ianaDataFingerprint` is
for — that one fingerprints the data itself, and the two are compared together.

What the data actually *is* deserves saying plainly. The language-range equivalences are
**generated from that registry snapshot, with no JDK**, by rules the spec states and publishes with
the data: which registry tags are equivalent, the order each class is expanded in, and the region and
variant substitutions (`-DE` and `-DD`, `-heploc` and `-alalc97`). The one thing the registry does
not state is the order in which those substitutions are tried, so that order is written down once,
taken from the JDK's own table so the answers agree with Java's. `lokalized-java` 3.1.0 generates
its default table from the same snapshot, and the spec checks the two equal entry by entry, and the
substitution order pair by pair. The JDK and the Java library are checks on the data, not its source.

So `parseLanguageRanges` expands a range the same way on every runtime:

<!-- example: iana-registry -->

```js
import { parseLanguageRanges } from "lokalized/negotiate";

parseLanguageRanges("iw").map((range) => range.range);       // => ["iw", "he"]
parseLanguageRanges("yol").map((range) => range.range);      // => ["yol", "enm"]
parseLanguageRanges("de-DE").map((range) => range.range);    // => ["de-de", "de-dd"]
```

That is `lokalized-java`'s `LocaleMatcher#parseLanguageRanges` on its default setting. Java's own
`Locale.LanguageRange.parse` reads the running JDK's table instead, and JDK 21's lacks twelve
registry tags — `bh`/`bih`, `enm`/`yol`, `mgp`/`mrd`, `mrh`/`shl`, `dyl`/`sgn-dyl` and
`zhk`/`sgn-zhk` — so on JDK 21 it answers `["yol"]` for the second line. `lokalized-java` can be
switched back to the JDK's table (`Strings.Builder#languageRangeEquivalents`); this package has no
such switch, because a JavaScript "JDK" table could only ever be JDK 21's, frozen.

---

### React Server Components, and what can cross the boundary

A server component passing props to a client component is a serialization boundary, and this library
has exactly one rule about those, stated in full under
[What crosses a boundary](#what-crosses-a-boundary): **the instance does not cross, the data does.**
Compiled expressions are closures, so `structuredClone` refuses a `Strings` outright and
`JSON.stringify` empties it to `{}` without an error — which is the one to watch for, because it is
the shape a framework's props serializer produces.

So a server component sends catalog data, or a manifest, and the client component constructs its own
instance from what it was handed. **Re-fetching is one option, not a requirement** — the props are
enough:

<!-- example: rsc -->

```js
import { createStrings } from "lokalized";

const catalog = { en: { Hi: "Hello, {{name}}" }, fr: { Hi: "Bonjour, {{name}}" } };
const server = createStrings({ strings: catalog, fallbackLocale: "en", locale: "fr" });

// Whatever the framework does to props, it is a JSON round trip at worst:
const props = JSON.parse(JSON.stringify({ catalog, locale: "fr" }));
const client = createStrings({ strings: props.catalog, fallbackLocale: "en", locale: props.locale });

client.get("Hi", { name: "Ada" }) === server.get("Hi", { name: "Ada" });   // => true
```

Values cross too, and stay themselves: a tagged language form is recognised **structurally**, so it
survives the trip and still selects — see
[Language forms are values, not strings](#language-forms-are-values-not-strings), where that is
executed against a clone, a `structuredClone` and a JSON round trip.

For the server-rendered page itself, the stamp is the narrower hand-off and it is a different
question from this one: see [Server rendering and the client hand-off](#server-rendering-and-the-client-hand-off).
A stamp tells a client whether the catalogs it already holds still match the server's build; it
carries no translations and is not a substitute for sending the data.

## Caching a localized page

A page rendered from `Accept-Language` is not keyed by its URL. It is keyed by whatever the
negotiation read — and that is more than the locale it chose.

<!-- example: cache-collision -->

```js
import { createStrings } from "lokalized";
import { createLocaleNegotiator, forAcceptLanguage } from "lokalized/negotiate";

const strings = createStrings({
  strings: {
    en: { Notice: "You asked for {{requested}}. This page is served in {{served}}." },
    fr: { Notice: "Vous avez demande {{requested}}. Cette page est servie en {{served}}." },
  },
  fallbackLocale: "en",
  locale: "en",
});

const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());
const swiss = forAcceptLanguage(negotiator, "fr-CH");
const belgian = forAcceptLanguage(negotiator, "fr-BE");

// Same selected locale, same match type. Nothing a narrow key can see separates them.
[swiss.localeMatch.locale, swiss.localeMatch.matchType];       // => ["fr", "cldr-fallback"]
[belgian.localeMatch.locale, belgian.localeMatch.matchType];   // => ["fr", "cldr-fallback"]

// And it is not the same page, because the page names what the visitor asked for.
const notice = (options) => strings.get("Notice", {
  requested: options.localeMatch.requestedLanguageRanges.map((range) => range.range).join(", "),
  served: options.localeMatch.locale,
}, options);

notice(swiss);
// => "Vous avez demande fr-ch. Cette page est servie en fr."
notice(belgian);
// => "Vous avez demande fr-be. Cette page est servie en fr."
```

**Two requests that select the same locale by the same match type are still owed different bytes.**
A cache keyed on the selected locale hands one visitor the other's page. There are two shapes that
are safe, and both are yours to build: this repository's `examples/app/cache-policy.js` implements
both, as code to copy rather than as a published import.

### Either key by the whole match

<!-- example: cache-key -->

```js
import { createStrings } from "lokalized";
import { createLocaleNegotiator, forAcceptLanguage } from "lokalized/negotiate";

const strings = createStrings({
  strings: { en: { Hi: "Hello" }, fr: { Hi: "Bonjour" } },
  fallbackLocale: "en",
  locale: "en",
});

const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());
const matchFor = (header) => forAcceptLanguage(negotiator, header).localeMatch;

// Enumerate the match, and check the enumeration is still complete.
Object.keys(matchFor("fr-CH")).sort();
// => ["consideredLocales", "effectiveWeight", "fallbackLocale", "isMatch", "languageRange", "locale", "matchType", "requestedLanguageRanges"]

const completeKey = (match) => JSON.stringify([
  match.matchType, match.locale, match.isMatch, match.fallbackLocale,
  match.effectiveWeight, match.languageRange,
  match.requestedLanguageRanges, match.consideredLocales,
]);

const narrowKey = (match) => JSON.stringify([match.locale, match.matchType]);

narrowKey(matchFor("fr-CH")) === narrowKey(matchFor("fr-BE"));       // => true
completeKey(matchFor("fr-CH")) === completeKey(matchFor("fr-BE"));   // => false
```

Enumerate the fields by name; do not `JSON.stringify` the match wholesale. That works today, but the
field order it depends on is the library's own and nothing in the published package gates it for you.
The `Object.keys` assertion above is the cheap version of that gate in your own suite.

The second collision is the one the negotiation section promised:

<!-- example: cache-key -->

```js
const unsupported = matchFor("de");       // a language you do not publish
const unreadable = matchFor("fr;q=2");    // a header that cannot be parsed

[unsupported.locale, unsupported.matchType];   // => [null, "none"]
[unreadable.locale, unreadable.matchType];     // => [null, "none"]

// Both render in your fallback. Only what they asked for separates them.
unsupported.requestedLanguageRanges.map((range) => range.range);   // => ["de"]
unreadable.requestedLanguageRanges;                                // => []
```

And the argument for an explicit key over `Vary: Accept-Language` is cardinality, not correctness:

<!-- example: cache-key -->

```js
const spellings = ["fr-CH", "fr-ch", "FR-CH", "Fr-Ch",
                   "fr-CH;q=1", "fr-CH ; q=1", "fr-CH;q=1.0", "fr-CH;q=1.000"];

new Set(spellings.map((header) => completeKey(matchFor(header)))).size;   // => 1

// But a wildcard is a match and an absent header is not, so those two must not collapse.
[matchFor("*").locale, matchFor("*").matchType];      // => ["en", "wildcard"]
[matchFor(null).locale, matchFor(null).matchType];    // => [null, "none"]
completeKey(matchFor("*")) === completeKey(matchFor(null));   // => false
```

`Vary: Accept-Language` is **correct** — every input the selection reads comes from that header — and
it is high-cardinality: eight spellings of one preference are eight entries in a shared cache where
an explicit key is one. Measure your own intermediaries before trusting either; a cache that
normalizes `Accept-Language` before keying can break the correctness `Vary` otherwise gives you.

### Or key by a locale in the URL

<!-- example: cache-redirect -->

```js
import { createStrings, forLocale } from "lokalized/core";
import { createLocaleNegotiator, forAcceptLanguage } from "lokalized/negotiate";

const strings = createStrings({
  strings: { en: { Hi: "Hello" }, fr: { Hi: "Bonjour" } },
  fallbackLocale: "en",
  locale: "en",
});

const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());

// One tag, no diagnostics. That is all a redirect needs, and it is fail-soft too.
negotiator.bestMatchForAcceptLanguage("fr-CH");    // => "fr"
negotiator.bestMatchForAcceptLanguage("fr-BE");    // => "fr"
negotiator.bestMatchForAcceptLanguage("de");       // => "en"
negotiator.bestMatchForAcceptLanguage("fr;q=2");   // => "en"
negotiator.bestMatchForAcceptLanguage(null);       // => "en"

// The target renders from the URL's tag alone, so `/fr/` is a complete key and needs no `Vary`.
strings.get("Hi", undefined, forLocale("fr"));   // => "Bonjour"

// And this is the price: the page can no longer tell that negotiation fell back.
strings.getResult("Hi", undefined, forAcceptLanguage(negotiator, "fr-CH")).isFallback;   // => true
strings.getResult("Hi", undefined, forLocale("fr")).isFallback;                          // => false
```

Negotiate once at the entry URL, redirect to `/fr/`, and the target reads nothing from the request.
That buys a URL-shaped key and a response with no `Vary` at all — but only for as long as the target
really does read nothing. The cost is the last two lines: a bare locale is not a match, so the page
loses the diagnostic that would let it say "showing you French — switch?".

Whichever shape you pick, the negotiating URL itself must carry `Vary: Accept-Language`, including on
its fail-soft responses. A fallback page served without `Vary` is a fallback page a shared cache then
serves to everyone.

### The version half of the key

Neither key is complete without something that changes when the translations do.

<!-- example: cache-fingerprint -->

```js
import { pathToFileURL } from "node:url";
import { createStrings } from "lokalized/core";
import { createStringsManifestFromDirectory, loadEntireManifestFromFiles } from "lokalized/node";

const directory = "examples/catalogs";
const common = {
  catalogVersion: "2026.09.15",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
};

const cdn = await createStringsManifestFromDirectory(directory, { ...common, publicationBaseUrl: "https://cdn.example/v1/" });
const mirror = await createStringsManifestFromDirectory(directory, { ...common, publicationBaseUrl: "https://mirror.example/i18n/" });

// The identity is a fact about the translations, so moving the files does not change it.
cdn.baseUrl !== mirror.baseUrl;                         // => true
cdn.catalogFingerprint === mirror.catalogFingerprint;   // => true

// An instance built from a manifest hands you that identity, so the key can carry it.
const local = await createStringsManifestFromDirectory(directory, { ...common, publicationBaseUrl: pathToFileURL("examples/catalogs/").href });
const strings = createStrings({ loaded: await loadEntireManifestFromFiles(local), locale: "en" });

strings.getCatalogIdentity().catalogVersion;                                  // => "2026.09.15"
strings.getCatalogIdentity().catalogFingerprint === cdn.catalogFingerprint;   // => true
```

The fingerprint is over the catalog **bytes**, not over their meaning. Running a formatter across
your catalogs moves it, and therefore invalidates every cache entry keyed on it, without changing a
word anybody reads:

<!-- example: cache-fingerprint -->

```js
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const original = mkdtempSync(join(tmpdir(), "lokalized-a-"));
const reformatted = mkdtempSync(join(tmpdir(), "lokalized-b-"));
cpSync(directory, original, { recursive: true });
cpSync(directory, reformatted, { recursive: true });

const before = readFileSync(join(reformatted, "fr.json"), "utf8");
writeFileSync(join(reformatted, "fr.json"), JSON.stringify(JSON.parse(before)));

// Same translations, different bytes.
readFileSync(join(reformatted, "fr.json"), "utf8") === before;   // => false

const one = await createStringsManifestFromDirectory(original, common);
const two = await createStringsManifestFromDirectory(reformatted, common);

one.catalogFingerprint === two.catalogFingerprint;   // => false

rmSync(original, { recursive: true });
rmSync(reformatted, { recursive: true });
```

The identity is `null` for a directly constructed instance, which has no verified load to identify:

<!-- example: cache-fingerprint -->

```js
createStrings({ strings: { en: { Hi: "Hello" } }, fallbackLocale: "en", locale: "en" }).getCatalogIdentity();   // => null
```

A deployment built that way has to take the version half of its key from its own build.

---

## Bundling and Content Security Policy

**No `unsafe-eval`.** The catalog expression language compiles to closures, not to evaluated code, so
an alternative selects normally in a realm where code generation from strings is forbidden. The first
assertion below is the control — without it, the second would be indistinguishable from a flag that
did nothing:

<!-- example: csp-no-eval -->

```js
import { execFileSync } from "node:child_process";

const BODY = `
  const { createStrings, GENDER_FEMININE } = await import("lokalized");
  const strings = createStrings({
    strings: { en: { Books: { translation: "{{who}} has {{n}} books.",
      placeholders: { who: { value: "g", translations: { GENDER_FEMININE: "She", GENDER_MASCULINE: "He" } } },
      alternatives: [{ "n == 0": "{{who}} has no books." }] } } },
    fallbackLocale: "en", locale: "en",
  });
  const evalWorks = (() => { try { (0, eval)("1"); return true; } catch { return false; } })();
  process.stdout.write(JSON.stringify({ evalWorks, zero: strings.get("Books", { g: GENDER_FEMININE, n: 0 }) }));`;

const underFlags = (flags) =>
  JSON.parse(execFileSync(process.execPath, [...flags, "--input-type=module", "-e", BODY], { encoding: "utf8" }));

underFlags([]);   // => { evalWorks: true, zero: "She has no books." }

underFlags(["--disallow-code-generation-from-strings"]);
// => { evalWorks: false, zero: "She has no books." }
```

That flag is V8's own analogue of a `script-src` without `unsafe-eval`; it is not a browser, and no
packed browser artifact exists in this repository yet. What it does establish is that nothing on the
rendering path needs `eval` or `new Function`.

**The rendering core reads exactly one non-ECMAScript global: `atob`**, for the base64-packed language
validity table. Everything a bundler polyfills by reflex is unnecessary:

<!-- example: csp-globals -->

```js
import { execFileSync } from "node:child_process";

const RENDER = `
  try {
    const { createStrings } = await import("lokalized");
    const strings = createStrings({ strings: { en: { Hi: "Hi {{n}}" } }, fallbackLocale: "en", locale: "en" });
    process.stdout.write(JSON.stringify({ rendered: strings.get("Hi", { n: 1 }) }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ failed: error.constructor.name }));
  }`;

const withoutGlobal = (name) => {
  const remove = name === null ? ""
    : `Object.defineProperty(globalThis, ${JSON.stringify(name)}, { value: undefined, configurable: true });`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `${remove}\n${RENDER}`], { encoding: "utf8" }));
};

// The control, so an empty filter below cannot mean "every child process failed".
withoutGlobal(null);   // => { rendered: "Hi 1" }

const CANDIDATES = ["atob", "TextDecoder", "URL", "crypto", "fetch", "Intl", "structuredClone", "navigator"];

CANDIDATES.filter((name) => withoutGlobal(name).rendered === undefined);   // => ["atob"]
```

`Intl` is on that list deliberately: plural and ordinal classification comes from pinned CLDR data, so
the library keeps working when it is gone, and two machines with different ICU builds answer
identically. `navigator` is read in exactly one place and only if you call `chooseBrowserLocale`.

### `lokalized/load` needs WebCrypto, and fails closed without it

`crypto.subtle` is secure-context gated, so a plain `http://` page does not have it. The loader
refuses **before any request** rather than fetching bodies it cannot verify — the request counter is
the load-bearing half of this assertion:

<!-- example: csp-nocrypto -->

```js
import { createStringsManifestFromDirectory } from "lokalized/node";
import { loadStrings } from "lokalized/load";

const manifest = await createStringsManifestFromDirectory("examples/catalogs", {
  catalogVersion: "v1",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
  publicationBaseUrl: "https://cdn.example/v1/",
});

Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });

let fetches = 0;
const transport = async () => { fetches += 1; throw new Error("the loader must not reach the network"); };

const outcome = await loadStrings(manifest, "en", { fetch: transport }).then(() => "loaded", (error) => error.code);

[outcome, fetches];   // => ["DIGEST_UNAVAILABLE", 0]
```

Catalog identity, manifest generation and the Node directory loader all keep working without
WebCrypto — the library carries its own synchronous SHA-256. Only verifying a **fetched body** needs
it. For a `connect-src` policy: a subset load is one GET per catalog in the chain, on the manifest's
own origin, with request init `{ mode: "cors", credentials: "same-origin" }`.

### Loading from a browser without a bundler

**The package ships a prebuilt browser distribution.** `package.json`'s `files` is `["src/", "types/", "dist/", "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md", "README.md", "CHANGELOG.md", "measurements/lokalized-parity.json", "DIVERGENCES.md"]`, and `dist/browser/`
holds the built form: one classic script, one single-file module root, and a module entry per
optional subpath. Everything below loads it straight from a CDN with no build step of your own.

The host in these examples is jsDelivr, which serves any published npm package at
`https://cdn.jsdelivr.net/npm/<package>@<version>/<path>` — no account, no configuration. It was
chosen over unpkg on one measurement that decides it for this package: **unpkg does not serve
brotli**, and the second column of the size table below is brotli. Substitute your own host freely;
the paths are what matter. These URLs name a published version, so they resolve as written; the
`./node_modules/…` form below needs no network at all and is the one to use offline.

**Pin an exact version. Never `latest`.** A moving target is a catalog format and a pinned CLDR
snapshot changing under a page you already shipped, and this library's whole premise is that two
machines answer identically.

#### A plain script tag

No modules, no import map, no build step — `lokalized.global.js` is a classic script that defines
one global:

```html
<script src="https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/lokalized.global.js"></script>
<script>
  const strings = lokalized.createStrings({
    strings: { en: { Hi: "Hello {{name}}" }, fr: { Hi: "Bonjour {{name}}" } },
    fallbackLocale: "en",
    locale: "fr",
  });

  document.body.textContent = strings.get("Hi", { name: "Ada" });   // Bonjour Ada
</script>
```

It is **one file containing every browser-safe subpath**, with the root's names on the global itself
and the rest namespaced — `lokalized.negotiate.createLocaleNegotiator`, `lokalized.load.loadStrings`,
`lokalized.ssr.createSsrStamp`, `lokalized.core.LokalizedError`,
`lokalized.data.ordinal.ordinalityForNumber`. `lokalized.createStrings` and
`lokalized.core.createStrings` are the same function object, because one bundle means one copy.

One file rather than one per subpath is a measurement, not a preference: a bundler cannot code-split
a classic script, so eight separate globals would each carry their own copy of the pinned CLDR
tables — around four times this file's total on the wire, two independent locale tables in memory,
and `instanceof` broken between them.

#### A module, by URL

An import map exists only so you can write the bare specifier `lokalized`. If you are willing to
write the URL, you need no map at all:

<!-- example: browser-quickstart -->

```html
<script type="module">
  import { createStrings } from "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/lokalized.js";

  const strings = createStrings({
    strings: { en: { Hi: "Hello {{name}}" }, fr: { Hi: "Bonjour {{name}}" } },
    fallbackLocale: "en",
    locale: "fr",
  });

  const greeting = strings.get("Hi", { name: "Ada" });   // => "Bonjour Ada"

  document.body.textContent = greeting;
</script>
```

`dist/browser/lokalized.js` is the **single-file root**: it carries the core, the expression
evaluator, the parser, the cardinal rules and the pinned locale data, and it imports nothing at all,
so that page is one request.

#### An import map, if you want the bare specifier

**To serve the copy you already have**, point the eight specifiers at your install — this needs no
network, and it is the form to start with:

```html
<script type="importmap">
{
  "imports": {
    "lokalized":                "./node_modules/lokalized/dist/browser/lokalized.js",
    "lokalized/core":           "./node_modules/lokalized/dist/browser/core.js",
    "lokalized/parse":          "./node_modules/lokalized/dist/browser/parse.js",
    "lokalized/load":           "./node_modules/lokalized/dist/browser/load.js",
    "lokalized/ssr":            "./node_modules/lokalized/dist/browser/ssr.js",
    "lokalized/negotiate":      "./node_modules/lokalized/dist/browser/negotiate.js",
    "lokalized/data/ordinal":   "./node_modules/lokalized/dist/browser/data/ordinal.js",
    "lokalized/data/ranges":    "./node_modules/lokalized/dist/browser/data/ranges.js"
  }
}
</script>
```

The same eight over the network:

```html
<script type="importmap">
{
  "imports": {
    "lokalized":                "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/lokalized.js",
    "lokalized/core":           "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/core.js",
    "lokalized/parse":          "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/parse.js",
    "lokalized/load":           "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/load.js",
    "lokalized/ssr":            "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/ssr.js",
    "lokalized/negotiate":      "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/negotiate.js",
    "lokalized/data/ordinal":   "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/data/ordinal.js",
    "lokalized/data/ranges":    "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/data/ranges.js"
  }
}
</script>
```

Each of the eight has to be spelled out either way: a trailing-slash shortcut such as
`"lokalized/": "./node_modules/lokalized/dist/browser/"` does not reproduce them, because the
subpaths are `exports` names rather than file paths — `lokalized/core` is `dist/browser/core.js`,
losing a directory level, while `lokalized/data/ordinal` keeps one as `dist/browser/data/ordinal.js`.

**`dist/browser/` is reachable by path, not by specifier.** It is deliberately absent from
`package.json`'s `exports`, so `import "lokalized/dist/browser/lokalized.js"` is
`ERR_PACKAGE_PATH_NOT_EXPORTED` in Node and in every bundler. That is the right answer for them:
a bundler should read `lokalized` and tree-shake the source. A browser fetching the path works,
which is what these maps and URLs do.

#### Do not mix the root with another subpath

The root is a single file that imports nothing, which is what makes it one request — and it
therefore **shares nothing with the other seven**. Loading `lokalized` beside
`lokalized/negotiate` downloads most of the locale kernel twice, gives you two independent copies of
the pinned tables, and makes `instanceof` fail across them, exactly as two installed copies do — the
`files` column below counts each entry on its own for that reason. The other seven DO share chunks
with each other, so `lokalized/core` beside `lokalized/load` is one copy.

So pick one of these, rather than combining them:

| you need | use | cost |
|---|---|---|
| to render, nothing else | the single-file root | 1 request |
| more than one subpath, no build step | the classic script | 1 request, everything |
| more than one subpath, with a bundler | `import "lokalized"` and let it tree-shake | see the table below |

`lokalized/core` is **not** a smaller drop-in for the root: of the root's 70 exports and core's 21,
only three are common. `forLocaleMatch` and every error class are core-only; the 61 language-form
constants and the plural helpers are root-only.

#### Four more things about these maps, each measured in a browser

- **`lokalized/node` is deliberately absent, and adding it breaks the page.** It is the one subpath
  that reaches Node built-ins — `node:crypto`, `node:fs`, `node:fs/promises`, `node:path` and
  `node:url` — so it has no browser build at all and the bundler refuses to produce one. The other
  eight all load: the root
  exports 70 names, `core` 21, `load` 10, `negotiate` 6, `parse` 5, `data/ordinal` 5, `ssr` 2 and
  `data/ranges` 2, and whole-list `Accept-Language` negotiation runs unchanged.
- **The visitor's own languages are `chooseBrowserLocale(configuration)`**, the one function in this
  library that reads `navigator`. It takes the configuration and nothing else, reading
  `navigator.languages` itself; `chooseLocaleForPreferredLanguages(configuration, languages)` is the
  same choice with the list passed in, which is what a server or a test uses. **Take the
  configuration from the instance rather than writing it out**, because the two drift and the drift
  is silent: a hand-kept `supportedLocales` naming a locale your catalogs do not have returns that
  locale, and the page then labels itself `lang="de"` while rendering the English fallback. In a host
  with no `navigator` at all this fails silently too — you get the fallback language, correctly
  labelled and not what the visitor asked for.
- **The page must be served over HTTP**, including during development. Opening the `.html` file
  directly gives it an opaque origin, and a browser refuses ES-module imports there — the classic
  script above is the one route that does load from `file://`.
- **Include only the subpaths you use.** Each entry is just a name the browser can resolve; it costs
  nothing until something imports it.

**If the page already has an import map, merge into its `imports` member** rather than adding a
second block. Two maps on one page do both apply in current Chromium — measured — but one map is the
form every browser that supports them at all accepts, and merging keeps a single place where a
specifier is resolved.


### What the digests protect

Each catalog is verified against a SHA-256 the **manifest** declares, and the manifest declares a
`catalogFingerprint` computed over those digests. That chain detects corruption and drift — a
truncated body, a stale CDN object, a catalog that moved without its manifest. **It is not
authenticity.** Nothing in this library verifies the manifest itself, so an attacker who can replace
the manifest *and* the files is inside the chain:

<!-- example: security-digests -->

```js
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStrings } from "lokalized/core";
import { loadEntireManifest } from "lokalized/load";
import { createStringsManifestFromDirectory } from "lokalized/node";

// Two payees, deliberately the same number of octets — a shorter body is refused by the declared
// byte count before any hash is computed, which would prove nothing about the digest.
const publish = async (payee) => {
  const directory = mkdtempSync(join(tmpdir(), "lokalized-trust-"));
  const body = JSON.stringify({ "Pay.To": payee });
  writeFileSync(join(directory, "en.json"), body);
  const manifest = await createStringsManifestFromDirectory(directory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  rmSync(directory, { recursive: true, force: true });
  return { manifest, bytes: new TextEncoder().encode(body) };
};

const honest = await publish("pay alice.example");
const attacker = await publish("pay molly.example");
const serving = (bytes) => async () => new Response(bytes);

const attempt = async (manifest, bytes) => {
  try {
    const loaded = await loadEntireManifest(manifest, { fetch: serving(bytes) });
    return { served: createStrings({ loaded, locale: "en" }).get("Pay.To") };
  } catch (error) {
    return { refused: error.failures?.map((failure) => `${failure.locale}:${failure.stage}`) ?? error.name };
  }
};

await attempt(honest.manifest, honest.bytes);        // => { served: "pay alice.example" }
await attempt(honest.manifest, attacker.bytes);      // => { refused: ["en:digest"] }

// And the case the chain does NOT cover: the manifest is the trust root, and it is not verified.
await attempt(attacker.manifest, attacker.bytes);    // => { served: "pay molly.example" }
```

So two things, and the library supplies neither:

- **Serve the manifest from an origin you trust, over `https`.** The chain starts there, and this is
  what makes it worth anything.
- **Or pin the identity out of band.** The forged manifest cannot reproduce the real one's
  fingerprint, so a value your build carries separately is a check the transport cannot forge:

<!-- example: security-digests -->

```js
const PUBLISHED_AT_BUILD_TIME = honest.manifest.catalogFingerprint;

const pinned = async (manifest, bytes) => {
  const loaded = await loadEntireManifest(manifest, { fetch: serving(bytes) });
  const strings = createStrings({ loaded, locale: "en" });
  return strings.getCatalogIdentity().catalogFingerprint === PUBLISHED_AT_BUILD_TIME
    ? strings.get("Pay.To")
    : "refused: this is not the catalog this build was released with";
};

await pinned(honest.manifest, honest.bytes);       // => "pay alice.example"
await pinned(attacker.manifest, attacker.bytes);
// => "refused: this is not the catalog this build was released with"
```

Stripping or blanking a digest is not an easier route — the manifest's own `catalogFingerprint` is
computed over them, so editing one invalidates the manifest before any body is fetched. The
regenerate-everything attack above is the only one that works, and only against an untrusted channel.

### When the data behind two builds disagrees

A manifest is published by one build of this library and read by another — your server generates it,
your browser loads it, and the two are the same release right up until the day they are not. The
manifest records the pinned data its publisher was built against, and **a reader on different data
refuses it rather than serving subtly different plurals.**

The build's own identity is on `lokalized/core`, not on the root:

<!-- example: mismatch -->

```js
import { cardinalityMode, cldrVersion, localeDataMode } from "lokalized/core";

[typeof cldrVersion, localeDataMode, cardinalityMode];   // => ["string", "pinned", "exact"]
```

Four kinds of disagreement are refused, all as a `ConfigurationError` and all **before a single file
is planned or fetched** — schema, semantic, fingerprint, and the runtime data itself:

<!-- example: mismatch -->

```js
import { createStringsManifestFromDirectory, loadEntireManifestFromFiles } from "lokalized/node";

const manifest = await createStringsManifestFromDirectory("examples/catalogs", {
  catalogVersion: "1",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] },
});

const refusal = async (mutate) => {
  const copy = JSON.parse(JSON.stringify(manifest));
  mutate(copy);
  try { await loadEntireManifestFromFiles(copy); return "loaded"; }
  catch (error) { return `${error.name}/${error.code}`; }
};

// schema, semantic, fingerprint, runtime data — one answer for all four:
const schema = await refusal((m) => { m.formatVersion = 99; });
const semantic = await refusal((m) => { m.fallbackLocale = "de"; });
const fingerprint = await refusal((m) => { m.catalogFingerprint = "0".repeat(64); });
const runtimeData = await refusal((m) => { m.cldrVersion = "47.1"; });

new Set([schema, semantic, fingerprint, runtimeData]);   // => new Set(["ConfigurationError/CONFIGURATION"])
```

And the runtime-data refusal names **both** sides, so the answer to "which half is stale?" is in the
error rather than in a support ticket:

<!-- example: mismatch -->

```js
const message = async (mutate) => {
  const copy = JSON.parse(JSON.stringify(manifest));
  mutate(copy);
  try { await loadEntireManifestFromFiles(copy); return ""; }
  catch (error) { return error.message; }
};

const stale = await message((m) => { m.cldrVersion = "47.1"; });

[stale.includes("published against CLDR 47.1"), stale.includes(cldrVersion)];   // => [true, true]
```

`catalogVersion` and `tiebreakers` are inside the `catalogFingerprint`, so editing either by hand is
caught as a fingerprint mismatch rather than going unnoticed.

**A manifest carries all seven identity fields, and so does the SSR stamp. A `LoadedStrings` record
carries two.** The manifest used to carry two as well, and the consequence was sharp enough to be
worth remembering: two builds differing only in their pinned IANA data published manifests that
were indistinguishable and loaded each other's without complaint. Range equivalence and whole-list
matching come from that data, so the two builds could negotiate the same visitor to different
catalogs while every file digest matched. The manifest door now compares all seven **before any
I/O**, and the mismatch is refused with a sentence naming which pair disagreed.

The record is the one that still carries two, and the gap is narrower than it looks: a record a
loader produced came through a manifest that was already checked on all seven. It matters only for a
record you build by hand, which the public type permits.

<!-- example: mismatch -->

```js
import { createStrings } from "lokalized/core";
import { createSsrStamp } from "lokalized/ssr";

const identity = [
  "cldrVersion", "dataFingerprint", "behavioralVectorsVersion",
  "localeDataMode", "cardinalityMode", "ianaRegistryDate", "ianaDataFingerprint",
];
const carries = (value) => identity.filter((field) => JSON.stringify(value).includes(field)).length;

const loaded = await loadEntireManifestFromFiles(manifest);
const strings = createStrings({ loaded, locale: "fr-CA" });
const stamp = createSsrStamp(strings, { kind: "locale", locale: "fr-CA" });

[carries(manifest), carries(loaded), carries(stamp)];   // => [7, 2, 7]
```

`getLoadVerification()` reports all seven, and the five a RECORD does not carry come from **the build
reading it**, not from the build that wrote it — so for a hand-built record it describes agreement on
two fields and local truth about five. Load through a manifest and all seven were compared on the way
in. Use it to report what you are running; for what produced your catalogs, the manifest is the
surface that was checked.

**What is deliberately *not* a data mismatch is the URL.** `baseUrl` and the per-file urls are
excluded from the catalog identity on purpose — it is what lets one catalog set be served from two
origins and still identify as the same data, which the
[one deployment, two manifests](#what-crosses-a-boundary) sample relies on. Point a manifest at a
directory that is not there and you get a `StringsLoadingError` naming the files, not a
`ConfigurationError`: the data did not disagree, the fetch failed.

### Two copies of the library break `instanceof`

If a bundler fails to dedupe — a server bundle plus a client bundle, or two versions in one tree —
the copies interoperate structurally and not by class. Match on `name` and `code`:

<!-- example: csp-dual -->

```js
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const first = await import("lokalized/core");

const copy = mkdtempSync(join(tmpdir(), "lokalized-second-"));
cpSync(fileURLToPath(new URL("./", import.meta.resolve("lokalized"))), join(copy, "src"), { recursive: true });
const second = await import(pathToFileURL(join(copy, "src/core/index.js")).href);

second.ConfigurationError === first.ConfigurationError;   // => false

const failure = (() => {
  try { first.createStrings({ strings: { en: {} }, fallbackLocale: "en", loaded: {} }); return null; }
  catch (error) { return error; }
})();

[failure instanceof first.ConfigurationError, failure instanceof second.ConfigurationError];   // => [true, false]
[failure instanceof first.LokalizedError, failure instanceof second.LokalizedError];           // => [true, false]
[failure.name, failure.code, failure instanceof Error];   // => ["ConfigurationError", "CONFIGURATION", true]

rmSync(copy, { recursive: true });
```

### What it costs a browser

<!-- bundle-table:start -->
**What a bundler leaves in your app.** Measured by `npm run check:bundle`, which bundles the
package `npm publish` would upload with esbuild 0.28.2 for a browser, minifies it,
and compresses it the way a CDN serves it — so these are tree-shaken figures for the import
written in the first column, not the size of any file this package ships. For that, see the
second table. Both columns are re-derived on every run, so they describe this commit.

| import | minified | brotli |
|---|---|---|
| `import { createStrings } from "lokalized"` | 181,266 | 54,179 |
| `import { createLocaleNegotiator, parseLanguageRanges } from "lokalized/negotiate"` | 89,541 | 31,257 |
| `import { createSsrStamp, validateSsrStamp } from "lokalized/ssr"` | 6,654 | 2,009 |
| `import { GENDER_FEMININE } from "lokalized"` | 2,350 | 914 |
| the four above, in one bundle | 222,213 | 64,406 |
<!-- bundle-table:end -->

<!-- dist-table:start -->
Measured by `npm run check:bundle` from the `dist/browser/` directory inside the packed
tarball — the files themselves, not a re-bundle of the source they were built from. `files` is
what a browser fetches for that entry: the entry plus every chunk it imports.

| load | files | raw | brotli |
|---|---|---|---|
| `lokalized` | 1 | 184,494 | 54,985 |
| `lokalized/core` | 7 | 183,611 | 54,881 |
| `lokalized/parse` | 5 | 159,522 | 48,641 |
| `lokalized/load` | 7 | 178,080 | 53,829 |
| `lokalized/ssr` | 2 | 7,582 | 2,383 |
| `lokalized/negotiate` | 4 | 90,810 | 31,688 |
| `lokalized/data/ordinal` | 8 | 190,319 | 56,708 |
| `lokalized/data/ranges` | 8 | 192,847 | 56,542 |
| `lokalized.global.js`, the classic script | 1 | 243,314 | 68,811 |
<!-- dist-table:end -->

**What a no-build page downloads.** The table above is what a bundler produces from the source; this
one is the `dist/browser/` files themselves, which is what the import maps and direct URLs above
fetch. The two differ for the root by about three thousand bytes, and the difference is real rather
than noise: a published entry point has to carry its own `export` statement and a sourcemap comment,
and it cannot tree-shake against an import it has never seen.

The second column is brotli rather than gzip because brotli is what a modern CDN negotiates first,
and because it is the one that can be checked: the same bundle compresses to the same brotli byte on
every Node this was tried on, while gzip moves with both the host's zlib build and the compression
level — and on one machine the level spread is wider than the version spread, so a gzipped size is
not a property of this package until you name a compressor and a level. Gzip is also appreciably
larger, so a figure quoted in it overstates what a visitor on a modern CDN actually downloads. It is
not printed here, because a number nothing re-derives is how this section came to be wrong before.

Three things are worth reading off that table. **Half of the root bundle is one pinned CLDR table** —
replacing `likely-subtags` with an empty one takes the same bundle from 181,266 to 158,337 minified
bytes, which is the price of resolving `fr-CH` to `fr` without asking the host. **The tables are
shared, not duplicated**: adding three more subpaths to the root costs 40,947 bytes, not another
whole copy. And **`lokalized/ssr` carries no pinned data at all**, which is what lets the stamp
module sit in a page that does no matching.

`lokalized/data/ordinal` adds 5,778 minified bytes and `lokalized/data/ranges` 8,327 — and neither is
reachable from `lokalized`, so you pay for them only by importing them.

The package is ESM-only, because the export map declares no CommonJS condition — dynamic `import()`
from CommonJS works, `require` does not:

<!-- example: csp-esm -->

```js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const attempt = (specifier) => { try { require(specifier); return "required"; } catch (error) { return error.code; } };

attempt("lokalized");             // => "ERR_PACKAGE_PATH_NOT_EXPORTED"
attempt("lokalized/negotiate");   // => "ERR_PACKAGE_PATH_NOT_EXPORTED"
Object.keys(await import("lokalized/ssr"));   // => ["createSsrStamp", "validateSsrStamp"]
```

`sideEffects` is declared `false` and bundlers honour it — removing that field takes the
single-constant import from 2,350 to 78,562 minified bytes, 33× larger.

---

## Coming from lokalized-java

**Your catalog files move over unchanged.** The JS port loads lokalized-java's own test catalogs
byte-for-byte, extensionless filenames included. What changes is the wiring around them.

One trap, and it is Java's too rather than this port's: a catalog file must be named with a BCP 47
tag — `fr-CA.json`, with a hyphen — and **`Locale.toString()` produces `fr_CA`, which neither runtime
will load.** Measured on JDK 21 against lokalized-java 3.0.0, a directory holding `pt_BR.json` is
refused with the same sentence you get here: *File 'pt_BR.json' ends with .json but is not named with
a valid IETF BCP 47 language tag.* If your deployment names files from `Locale.toString()`, it was
already not loading them; if it names them from `toLanguageTag()`, they move over as promised.

| lokalized-java | here |
|---|---|
| `Strings.Builder(...)...build()` | one options object: `createStrings({ … })` |
| `Strings` **is a** `LocaleMatcher` | matching is a separate module: `createLocaleNegotiator(strings.getLocaleConfiguration())` |
| `matchFor(Locale)` / `matchFor(List<LanguageRange>)` overloads | two names: `matchFor(tag)` and `matchForLanguageRanges(ranges)` |
| `parseLanguageRanges(String)` on the default `LanguageRangeEquivalents.IANA_REGISTRY` | `parseLanguageRanges(header)` from `lokalized/negotiate`, the same registry table |
| `Strings.Builder#languageRangeEquivalents(JDK)` | no counterpart — there is no JDK here to defer to |
| `.localeSupplier(matcher -> …)` | `localeResolver`, called with **no arguments** — close over a negotiator instead |
| `Optional<T>` | `null` |
| enum constants | kebab-case strings for statuses and reasons; frozen records for language forms |
| `loadFromClasspath` | no counterpart — the loaders here are filesystem, fetch and manifest |
| ordinal and range tables on the default path | opt-in subpaths, `lokalized/data/ordinal` and `lokalized/data/ranges` |

**A catalog that needs zero configuration in Java can refuse to construct here.** If it uses
`ORDINALITY_*` or a `range` placeholder, you must pass the opt-in data — the root graph cannot reach
those tables, which is what keeps them out of a browser bundle that does not use them.

Several refusal messages are byte-identical across the two implementations, and the port keeps Java's
wording wherever a counterpart exists:

<!-- example: migration -->

```js
import { createStrings } from "lokalized";

let message = "";
try {
  createStrings({ strings: { en: { Hi: "Hello" } }, fallbackLocale: "de", locale: "en" });
} catch (error) {
  message = error.message;
}

message;
// => "Specified fallback locale is 'de' but no matching localized strings locale was found. Known locales: [en]"
```

The **type** is a `RangeError` where Java raises `IllegalArgumentException` — JavaScript names with
Java's shape. That is a mapping per site, not a general rule; check the error you actually catch.

Every library error class carries a `code` and extends an exported `LokalizedError`, which Java has
no equivalent of, so `catch (e) { if (e instanceof LokalizedError) … }` is one test for "this came
from lokalized". It does **not** catch everything the library raises: argument refusals like the one
above are plain `RangeError`s.

The count is derived rather than stated, because a number in prose is a claim nothing checks — this
sentence said **five** until 2026-09-17, written before `ResolutionError` landed and never re-read:

<!-- example: migration-errors -->

```js
import { LokalizedError } from "lokalized/core";

const subpaths = [
  "lokalized", "lokalized/core", "lokalized/parse", "lokalized/load", "lokalized/ssr",
  "lokalized/negotiate", "lokalized/node", "lokalized/data/ordinal", "lokalized/data/ranges",
];
const classes = new Map();
for (const subpath of subpaths)
  for (const [name, value] of Object.entries(await import(subpath)))
    if (typeof value === "function" && name.endsWith("Error")) classes.set(name, value);

const subclasses = [...classes].filter(([, kind]) => kind.prototype instanceof LokalizedError);

// A FLOOR, not an exact count, set at today's number — the same reason this sentence rotted once.
subclasses.length >= 8;   // => true
[...classes].some(([name]) => name === "LokalizedError");   // => true
[...classes].every(([, kind]) => kind === LokalizedError || kind.prototype instanceof LokalizedError);
// => true
```

---

## How this differs from i18next

**For most applications i18next is the better choice, and this section is measured rather than
argued.** Everything below was produced by running both libraries — `tools/i18next-diff/run.mjs`
against i18next 26.4.2 on v24.18.0 — and recorded in `measurements/i18next.json`.
`npm run diff:check` re-checks that record on every build, and it **fails if no probe finds i18next
better**, because a comparison in which the competitor never wins is not a result.

Of seven axes measured: i18next is better on four, stricter behaviour goes to lokalized on one, one
is a genuine tie and one has no winner.


### Shipping only the locale data you use

Half of that download is one table: CLDR's likely-subtag map, 7,788 rows covering every language in
the world. It is what turns `zh` into `zh-Hans-CN` so the right catalog answers, and what tells the
renderer that `ar` is right-to-left.

An application serving five locales reaches **four** of those rows. `tools/subset-likely-subtags.mjs`
emits a table holding just those, and a bundler alias points the library's data module at it:

```bash
node node_modules/lokalized/tools/subset-likely-subtags.mjs --catalogs ./locales --out src/locale-data.js
```

```
subset: 4 of 7788 rows (0.05%), 1064 bytes of source, for en, es, fr, fr-CA, ja
```

Then alias `lokalized/src/data/likely-subtags.js` to the generated file — `resolve.alias` in Vite and
webpack, `alias` in esbuild, `@rollup/plugin-alias` in Rollup. Nothing else changes: the generated
module has the same shape as the one it replaces, so there is no option to pass and no API to learn.

**The rows are copied from the pinned table, not recomputed**, so wherever the subset has an answer
it is the same answer — no host `Intl`, no CLDR version to drift against. And requests for languages
you do not serve resolve identically too: maximizing a request can only change an answer if it could
match a locale you serve, and those rows are always included. Measured over 424 requested tags,
including the script, region and deprecated-code cases most likely to behave oddly: zero differences.

The one thing to remember is to regenerate it when you add a locale. A stale subset silently loses
maximization for the new one; the emitted file records the locale set and the source fingerprint in
its header so a build can check.

### Where i18next is better

**It formats numbers, dates and currency inside a message; lokalized cannot.** Measured, German:

| | i18next | lokalized |
|---|---|---|
| `"Summe: {{v, number}}"` | `Summe: 1.234.567,891` | `Summe: 1234567.891` |
| `"Preis: {{v, currency(EUR)}}"` | `Preis: 1.234,50 €` | no formatter slot |

This is not an oversight here — it is the pinned-data policy. `Intl` appears in **zero** of the
54 files under `src/`, and a
test fails the build on a bare reference to it, so that two machines on different ICU builds render
identically. The cost is that you format values yourself before passing them in.

**It escapes interpolated values by default.** Given `"Hi {{name}}"` and a name of
`<script>x</script>`:

| i18next | lokalized |
|---|---|
| `Hi &lt;script&gt;x&lt;&#x2F;script&gt;` | `Hi <script>x</script>` |

lokalized exports nothing for escaping or sanitising on any subpath. If you interpolate
user-supplied text into HTML, that is yours to handle.

**Ordinals need one option in i18next and a second import here.** Both render
`1st, 2nd, 3rd, 4th`. i18next takes
`{ ordinal: true }` on the call; lokalized **refuses to construct** until you import
`lokalized/data/ordinal` and pass `pluralData` — deliberate, so a page that never asks an ordinal
question does not pay for the table, but plainly more work.

**It starts faster.** Import, construct and render one string:
**2.6 ms**
against **14.7 ms**.
lokalized decodes pinned CLDR tables at import; i18next asks the host and has nothing to decode.
Reported, never gated — one machine, one run shape.

**And it has a great deal this does not**: framework bindings, namespaces, language detection,
backend plugins, key-to-key composition. lokalized has none of those and is not trying to.

**The lokalized column of every table above is executed here**, so the side of this comparison that
is this library's cannot drift from it. The i18next column comes from `measurements/i18next.json`,
which `npm run diff:check` re-checks on every build:

<!-- example: i18next -->

```js
import { createStrings } from "lokalized/core";

const strings = createStrings({
  strings: {
    en: { hi: "Hi {{name}}", sum: "Summe: {{v}}" },
    fr: { b: { translation: "{{count}} {{w}}", placeholders: { w: { value: "count",
      translations: { CARDINALITY_ONE: "livre", CARDINALITY_OTHER: "livres" } } } } },
  },
  fallbackLocale: "en",
  locale: "en",
});

// No escaping: an interpolated value is passed through exactly as given.
strings.get("hi", { name: "<script>x</script>" });   // => "Hi <script>x</script>"

// No formatter slot: the number arrives as JavaScript spells it, not as German does.
strings.get("sum", { v: 1234567.891 });              // => "Summe: 1234567.891"
```

<!-- example: i18next -->

```js
import { forLocale } from "lokalized/core";

// The French catalog above declares ONE and OTHER but not MANY, which French requires. At a count
// that selects MANY the message cannot be resolved and the key comes back — visibly broken, which
// is the half of this trade worth having.
strings.get("b", { count: 1 }, forLocale("fr"));         // => "1 livre"
strings.get("b", { count: 1000000 }, forLocale("fr"));   // => "b"
```

### Where this library is stricter

**Plural rules come from data pinned in the package, not from the host.** i18next selects through
`Intl.PluralRules`, so two machines on different ICU builds can disagree — and equally, i18next picks
up CLDR corrections for free when the host updates. lokalized renders identically everywhere and goes
stale until you update the package. Which you want is a real choice, not a ranking.

With complete catalogs the two agree:
**27 of
27 cells identical** across
a two-form, a three-form and a four-form language. Neither is better at plurals.

### The one worth thinking about

**A French catalog missing `CARDINALITY_MANY`, rendered at 1,000,000, with English behind it as the
fallback.** Both libraries fail, differently:

| | at 1 | at 1,000,000 | told before serving? |
|---|---|---|---|
| i18next | `1 livre` | `1000000 books` | only if you ask |
| lokalized | `1 livre` | `b` | yes, at load |

**i18next serves your French reader an English sentence and its missing-key handler does not fire**,
because a translation *was* found. The page looks fine and is in the wrong language. lokalized renders
the raw key — obviously broken, obviously wrong. Before serving, lokalized warns at load naming the
exact missing form; i18next will tell you which suffixes a language needs if you ask
(`pluralResolver.getSuffixes("fr")` returns
`['_one', '_many', '_other']`), so the
same check is a few lines away.

**Neither is silent by nature. The difference is which failure you would rather ship** — and this
library shipped the wrong-language version of exactly this bug for months, because the sample code
reading its own catalogs threw the warnings away.

### So: use i18next unless

You need **parity with lokalized-java**, or rendering that **cannot vary with the host's ICU**, or the
grammatical-form model (gender, case, definiteness) that this library has and i18next's `context` only
approximates. Those are the reasons this exists. If none of them is your problem, i18next is a larger,
faster-starting, better-supported library and you should use it.

## Entry points

Every entry point is a separate subpath so you only pay for what you import.

| Import | What it is |
|---|---|
| `lokalized` | `createStrings`, the browser locale chooser, the plural classifiers, and all the language-form constants |
| `lokalized/core` | The same `createStrings` and chooser plus per-call option helpers, the error classes, and build identity — without the language-form constants |
| `lokalized/parse` | `parseStrings`, `defineLocalizedString`, `defineCatalog`, `mergeParsedStringsFiles` |
| `lokalized/load` | Manifest parsing, digest-verified fetching, catalog identity |
| `lokalized/node` | Directory and file loaders, and the manifest generator |
| `lokalized/negotiate` | The whole-list `Accept-Language` solver and the full IANA language table |
| `lokalized/ssr` | The server-render stamp, for handing a verified catalog identity to the client |
| `lokalized/data/ordinal` | Ordinal ("1st", "2nd") classification data — opt-in |
| `lokalized/data/ranges` | Cardinal-range ("1–3 books") data — opt-in |

The optional data modules are **not reachable from `lokalized`**. That is enforced by a test, not by
convention: importing the root never pulls the ordinal or range tables into your bundle.

---

## What this port does and does not do

It reproduces `lokalized-java` 3.1.0's behaviour, including its messages, wherever a Java counterpart
exists. Where the two must differ, the difference is declared rather than incidental:

- **Error types use JavaScript names with Java's shape.** Java's `IllegalArgumentException` for a
  malformed tag is a `RangeError` here.
- **Nothing is read from the host.** Plural and ordinal classification come from pinned CLDR data,
  never `Intl.PluralRules`, so two machines with different ICU versions answer identically.
- **JVM-only concepts are absent.** Classpath discovery has no counterpart; the loaders here are
  filesystem, fetch and manifest.

Everything else — the expression language, the matching order, the fallback walk, the warnings, the
limits — is the same library.

## The catalogs these samples use

Every sample above that loads from a directory reads `examples/catalogs`, and until now this document
never showed you what was in it — so the outputs those samples assert were not reproducible from the
document alone. Here are the four files, complete. Write them to `examples/catalogs/` (or anywhere
else, and change the path in the sample) and every directory sample in this README runs as printed.

They are a deliberately awkward set rather than a tidy one: `fr` and `fr-CA` are the ambiguity that
makes a tiebreaker necessary, `fr-CA` overrides only some of `fr`'s keys so the per-key fallback walk
has something to do, and `es` is a locale with no regional sibling to contrast with them.

<!-- catalog: examples/catalogs/en.json -->

```json
{
  "App.Title": "The Lokalized Bookshop",

  "Locale.Direct": "This page is served in {{served}}.",

  "Locale.Notice": "You asked for {{requested}}. This page is served in {{served}}.",

  "Cart.Items": {
    "translation": "Your cart holds {{count}} {{books}}.",
    "placeholders": {
      "books": {
        "value": "count",
        "translations": {
          "CARDINALITY_ONE": "book",
          "CARDINALITY_OTHER": "books"
        }
      }
    }
  },

  "Greeting": {
    "translation": "Welcome back, {{name}}. {{youAre}} on your own reading list.",
    "placeholders": {
      "youAre": {
        "value": "readerGender",
        "translations": {
          "GENDER_MASCULINE": "He is",
          "GENDER_FEMININE": "She is",
          "GENDER_COMMON": "They are"
        }
      }
    }
  },

  "Checkout.Cta": "Check out"
}
```

<!-- catalog: examples/catalogs/es.json -->

```json
{
  "App.Title": "La libreria Lokalized",

  "Locale.Direct": "Esta pagina se sirve en {{served}}.",

  "Locale.Notice": "Pediste {{requested}}. Esta pagina se sirve en {{served}}.",

  "Cart.Items": {
    "translation": "Tu carrito tiene {{count}} {{books}}.",
    "placeholders": {
      "books": {
        "value": "count",
        "translations": {
          "CARDINALITY_ONE": "libro",
          "CARDINALITY_MANY": "libros",
          "CARDINALITY_OTHER": "libros"
        }
      }
    }
  },

  "Greeting": {
    "translation": "Bienvenido de nuevo, {{name}}. {{youAre}} en tu lista de lectura.",
    "placeholders": {
      "youAre": {
        "value": "readerGender",
        "translations": {
          "GENDER_MASCULINE": "El esta",
          "GENDER_FEMININE": "Ella esta",
          "GENDER_COMMON": "Elle esta"
        }
      }
    }
  },

  "Checkout.Cta": "Pagar"
}
```

<!-- catalog: examples/catalogs/fr.json -->

```json
{
  "App.Title": "La librairie Lokalized",

  "Locale.Direct": "Cette page est servie en {{served}}.",

  "Locale.Notice": "Vous avez demande {{requested}}. Cette page est servie en {{served}}.",

  "Cart.Items": {
    "translation": "Votre panier contient {{count}} {{books}}.",
    "placeholders": {
      "books": {
        "value": "count",
        "translations": {
          "CARDINALITY_ONE": "livre",
          "CARDINALITY_MANY": "livres",
          "CARDINALITY_OTHER": "livres"
        }
      }
    }
  },

  "Greeting": {
    "translation": "Bon retour, {{name}}. {{youAre}} dans votre liste de lecture.",
    "placeholders": {
      "youAre": {
        "value": "readerGender",
        "translations": {
          "GENDER_MASCULINE": "Il est",
          "GENDER_FEMININE": "Elle est",
          "GENDER_COMMON": "Iels sont"
        }
      }
    }
  },

  "Checkout.Cta": "Passer la commande"
}
```

<!-- catalog: examples/catalogs/fr-CA.json -->

```json
{
  "App.Title": "La librairie Lokalized du Canada",

  "Locale.Direct": "Cette page est servie en {{served}}.",

  "Locale.Notice": "Vous avez demande {{requested}}. Cette page est servie en {{served}}.",

  "Cart.Items": {
    "translation": "Votre panier compte {{count}} {{books}}.",
    "placeholders": {
      "books": {
        "value": "count",
        "translations": {
          "CARDINALITY_ONE": "livre",
          "CARDINALITY_MANY": "livres",
          "CARDINALITY_OTHER": "livres"
        }
      }
    }
  },

  "Greeting": {
    "translation": "Bon retour, {{name}}. {{youAre}} dans votre liste de lecture.",
    "placeholders": {
      "youAre": {
        "value": "readerGender",
        "translations": {
          "GENDER_MASCULINE": "Il est",
          "GENDER_FEMININE": "Elle est",
          "GENDER_COMMON": "Iels sont"
        }
      }
    }
  }
}
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The package also embeds generated data derived from Unicode CLDR, under Unicode License v3, and ports the observable behaviour of a JSON reader the upstream Java implementation embeds. Both are described in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which is published with the package.
