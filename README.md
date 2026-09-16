# lokalized

Natural-sounding translations in JavaScript, with no runtime dependencies.

Lokalized keeps locale-specific grammar out of your application code. Plural rules, gender agreement,
grammatical case, formality and the rest live **with the translations**, where a translator can reach
them — not scattered through conditionals in your components.

This is a JavaScript port of [lokalized-java](https://www.lokalized.com), behaviour-for-behaviour.
Every rule below is arbitrated against the Java implementation by an executed test corpus rather than
by description.

```bash
npm install lokalized
```

Requires Node 22+ or any modern browser. **Zero dependencies.** ESM only.

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

### Ambiguity is refused, not guessed

That `tiebreakers` entry is not optional. With both `fr` and `fr-CA` loaded, a request for plain `fr`
is ambiguous — and rather than pick one, **construction fails and tells you what to declare**:

```
RangeError: You must specify tiebreaker locales via createStrings({ tiebreakers }) to resolve
ambiguity for language code 'fr' because localized strings exist for the following locale[s]:
[fr, fr-CA]
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

Each file is named for its locale — `en.json`, `fr-CA.json`. Loading is bounded: file count, total
bytes, translation nodes and warnings all have limits, so a hostile or corrupt directory fails
closed rather than exhausting memory.

### Over the network (browser, edge, or server)

`lokalized/load` fetches only the catalogs a given locale needs, verifies each against a SHA-256
digest recorded in a manifest, and hands back a record you pass straight to `createStrings`:

```js
import { createStrings } from "lokalized/core";
import { loadStrings, parseStringsManifest } from "lokalized/load";

const manifest = parseStringsManifest(await (await fetch("/i18n/manifest.json")).text());
const loaded = await loadStrings(manifest, "fr-CA");

const strings = createStrings({ loaded, locale: "fr-CA" });
```

`lokalized/node` has the same doors over the filesystem, and
`createStringsManifestFromDirectory` generates the manifest at publish time.

---

## Negotiating from `Accept-Language`

`lokalized/negotiate` carries the full RFC 4647 solver — q-values, wildcards, and the pinned IANA
equivalence closure. It is a **separate entry point on purpose**: the tables it needs are large, and
keeping them out of the rendering graph is the reason you can ship the core to a browser.

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

**These seven are yours to tighten**, under the option name each door uses — `parseStrings(src,
{ limits })`, `createStrings({ loadingLimits })`, `readStringsFromDirectory(dir, { limits })`,
`loadStrings(manifest, locale, { limits })`. Note that `createStrings` spells it `loadingLimits`, and
a `limits` key there is **silently ignored** rather than refused:

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
build({ limits: { maximumTranslationNodes: 1 } });   // => "constructed"
```

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

// Not a date, despite the name — see the end of this section.
/^\d{4}-\d{2}-\d{2}$/.test(stamp.ianaRegistryDate);   // => false
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

And `ianaRegistryDate` is **not a date**. The IANA equivalence closure here is pinned to a JDK build
rather than to a registry release, so the field carries that build identifier. It is an opaque
provenance string that two deployments must agree on, and nothing more.

---

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

### Two copies of the library break `instanceof`

If a bundler fails to dedupe — a server bundle plus a client bundle, or two versions in one tree —
the copies interoperate structurally and not by class. Match on `name` and `code`:

<!-- example: csp-dual -->

```js
import { cpSync, mkdtempSync } from "node:fs";
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
```

### What it costs a browser

Measured with esbuild 0.24.2 against this checkout, minified and gzipped, as a snapshot rather than a
promise:

| import | minified | gzipped |
|---|---|---|
| `createStrings` from `lokalized` | 317,336 | 100,591 |
| `lokalized/negotiate` | 243,276 | 78,651 |
| `lokalized/ssr` | 5,693 | 2,075 |
| one language-form constant alone | 2,359 | 1,004 |
| root + negotiate + ssr + load together | 369,380 | 117,933 |

Three things are worth reading off that table. **Half of the root bundle is one pinned CLDR table** —
gutting `likely-subtags` takes the same bundle from 317,336 to 159,721 minified bytes, which is the
price of resolving `fr-CH` to `fr` without asking the host. **The tables are shared, not
duplicated**: adding three more subpaths to the root costs 52,044 bytes, not another whole copy. And
**`lokalized/ssr` carries no pinned data at all**, which is what lets the stamp module sit in a page
that does no matching.

`lokalized/data/ordinal` adds 5,348 minified bytes and `lokalized/data/ranges` 8,052 — and neither is
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

`sideEffects` is
declared `false` and bundlers honour it — deleting that field makes a single-constant import 90×
larger.

---

## Coming from lokalized-java

**Your catalog files move over unchanged.** The JS port loads lokalized-java's own test catalogs
byte-for-byte, extensionless filenames included. What changes is the wiring around them.

| lokalized-java | here |
|---|---|
| `Strings.Builder(...)...build()` | one options object: `createStrings({ … })` |
| `Strings` **is a** `LocaleMatcher` | matching is a separate module: `createLocaleNegotiator(strings.getLocaleConfiguration())` |
| `matchFor(Locale)` / `matchFor(List<LanguageRange>)` overloads | two names: `matchFor(tag)` and `matchForLanguageRanges(ranges)` |
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

Five error classes carry a `code` and extend an exported `LokalizedError`, which Java has no
equivalent of, so `catch (e) { if (e instanceof LokalizedError) … }` is one test for "this came from
lokalized". It does **not** catch everything the library raises: argument refusals like the one above
are plain `RangeError`s.

---

## Entry points

Every entry point is a separate subpath so you only pay for what you import.

| Import | What it is |
|---|---|
| `lokalized` | `createStrings`, the browser locale chooser, the plural classifiers, and all the language-form constants |
| `lokalized/core` | The same `createStrings` plus per-call option helpers, the error classes, and build identity — no chooser |
| `lokalized/parse` | `parseStrings`, `defineLocalizedString`, `defineCatalog`, `mergeParsedStringsFiles` |
| `lokalized/load` | Manifest parsing, digest-verified fetching, catalog identity |
| `lokalized/node` | Directory and file loaders, and the manifest generator |
| `lokalized/negotiate` | The whole-list `Accept-Language` solver and the IANA closure |
| `lokalized/ssr` | The server-render stamp, for handing a verified catalog identity to the client |
| `lokalized/data/ordinal` | Ordinal ("1st", "2nd") classification data — opt-in |
| `lokalized/data/ranges` | Cardinal-range ("1–3 books") data — opt-in |

The optional data modules are **not reachable from `lokalized`**. That is enforced by a test, not by
convention: importing the root never pulls the ordinal or range tables into your bundle.

---

## What this port does and does not do

It reproduces `lokalized-java` 3.0.0's behaviour, including its messages, wherever a Java counterpart
exists. Where the two must differ, the difference is declared rather than incidental:

- **Error types use JavaScript names with Java's shape.** Java's `IllegalArgumentException` for a
  malformed tag is a `RangeError` here.
- **Nothing is read from the host.** Plural and ordinal classification come from pinned CLDR data,
  never `Intl.PluralRules`, so two machines with different ICU versions answer identically.
- **JVM-only concepts are absent.** Classpath discovery has no counterpart; the loaders here are
  filesystem, fetch and manifest.

Everything else — the expression language, the matching order, the fallback walk, the warnings, the
limits — is the same library.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
