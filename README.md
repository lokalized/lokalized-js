<a href="https://lokalized.com">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://cdn.lokalized.com/lokalized-gh-logo-dark-v6.png">
        <img alt="Lokalized" src="https://cdn.lokalized.com/lokalized-gh-logo-light-v6.png" width="300" height="93">
    </picture>
</a>


Lokalized facilitates natural-sounding software translations in browsers and Node.js.

It is both a file format...

```json
{
  "I read {{bookCount}} books.": {
    "translation": "I read {{bookCount}} {{books}}.",
    "placeholders": {
      "books": {
        "value": "bookCount",
        "translations": {
          "CARDINALITY_ONE": "book",
          "CARDINALITY_OTHER": "books"
        }
      }
    },
    "alternatives": [
      {
        "bookCount == 0": "I didn't read any books."
      }
    ]
  }
}
```

...and a library that operates on it:

Save this as `examples/readme/intro/en.json`:

<!-- catalog: examples/readme/intro/en.json -->

```json
{
  "I read {{bookCount}} books.": {
    "translation": "I read {{bookCount}} {{books}}.",
    "placeholders": {
      "books": {
        "value": "bookCount",
        "translations": {
          "CARDINALITY_ONE": "book",
          "CARDINALITY_OTHER": "books"
        }
      }
    },
    "alternatives": [
      {
        "bookCount == 0": "I didn't read any books."
      }
    ]
  }
}
```

<!-- example: overview-intro -->

```js
import { createStrings } from "lokalized";
import { readStringsFromDirectory } from "lokalized/node";

const { catalogs } = await readStringsFromDirectory("examples/readme/intro");
const introStrings = createStrings({
  localizedStringSupplier: () => catalogs,
  fallbackLocale: "en",
  localeSupplier: () => "en",
});

introStrings.get("I read {{bookCount}} books.", { bookCount: 0 }); // => "I didn't read any books."
```

Lokalized has proudly powered production systems since 2017. The Java, JavaScript, and Swift libraries share the same translation-file format; platform APIs adapt how applications supply values and load files.

**Note: this README provides a high-level overview of Lokalized.**<br/>
**For details, see the [official documentation](https://www.lokalized.com/?platform=javascript) and [JavaScript API reference](https://jsdoc.lokalized.com/1.0.0/).**

## Why Lokalized?

- **Keep language rules out of application code:** locale-specific grammar and wording live with the translations instead of being scattered through conditionals.
- **Give translators expressive control:** placeholders, language forms, and ordered alternatives can rewrite a fragment or an entire message when natural copy requires it.
- **Model more than simple plurals:** cardinality, ordinality, ranges, gender, grammatical case, definiteness, classifiers, formality, clusivity, animacy, and phonetics are first-class concepts.
- **Solve agreement problems many localization formats do not model directly:** a small expression language supports compound conditions over runtime facts; [see how Lokalized compares](#comparing-localization-formats).
- **Match locales predictably:** BCP 47 tags, CLDR parent locales, likely scripts, language preferences, and explicit tiebreakers produce deterministic results; [see the matching order](#locale-matching-behavior).
- **Fail safely:** bounded loading and evaluation, explicit fallback policies, and structured diagnostics make malformed or incomplete translations observable.
- **Stay lightweight:** immutable catalogs and reusable translation instances with **zero runtime dependencies**.

## Non-Goals

- Date/time, number, percentage, and currency formatting or parsing: use JavaScript [`Intl`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl) formatters.
- Collation: use [`Intl.Collator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator).
- CommonJS or older JavaScript runtimes: use Node.js 20+ or a modern browser with ES module support.

## Do Zero-Dependency Libraries Interest You?

Similarly flavored, commercially friendly OSS libraries are available for Java:

- [Pyranid](https://www.pyranid.com) — a modern JDBC interface that embraces SQL.
- [Soklet](https://www.soklet.com) — an HTTP/1.1 server with support for virtual threads, Server-Sent Events, and Model Context Protocol.

## License

[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0). See [LICENSE](LICENSE), [NOTICE](NOTICE), and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for project and generated-data attribution.

## npm Installation

For Node.js or a browser application with a bundler:

```sh
npm install lokalized@1.0.0
```

The npm entry points use ES modules and include TypeScript declarations. A standalone [classic script](#plain-script-tag) is also included. Installing with npm does not mean your application must run on Node.js.

## Browser and Node.js

The translation API works in both environments. Node.js can read local files through `lokalized/node`. Browsers can supply inline translations or fetch published files through `lokalized/load`. Use a [plain script tag](#plain-script-tag) or [ES module](#es-modules) for a page with no Node.js server or build step.

## Direct Download

Import the prebuilt browser module from a versioned CDN URL:

<!-- example: overview-cdn -->

```js
import { createStrings } from "https://cdn.jsdelivr.net/npm/lokalized@1.0.0/dist/browser/lokalized.js";

typeof createStrings; // => "function"
```

Keep all browser imports on one package version. The [JavaScript platform guide](Documentation/JAVASCRIPT-GUIDE.md#loading-from-a-browser-without-a-bundler) covers classic scripts, import maps, entry points, CSP, and measured bundle sizes.

## Getting Started

We will start with hands-on examples to illustrate the same features shown by the Java library.

### 1. Create Localized Strings Files

Filenames follow the IETF BCP 47 language-tag format, optionally suffixed with `.json`. This Brazilian Portuguese (`pt-BR`) file uses English source text as the lookup key:

Save this as `examples/readme/books/pt-BR.json`:

<!-- catalog: examples/readme/books/pt-BR.json -->

```json
{
  "I read {{bookCount}} books.": {
    "translation": "Li {{bookCount}} {{books}}.",
    "placeholders": {
      "books": {
        "value": "bookCount",
        "translations": {
          "CARDINALITY_ONE": "livro",
          "CARDINALITY_OTHER": "livros"
        }
      }
    },
    "alternatives": [
      {
        "bookCount == 0": "Não li nenhum livro."
      }
    ]
  }
}
```

### 2. Create a Strings Instance

Load the localized strings once, then construct a reusable [`Strings`](https://jsdoc.lokalized.com/1.0.0/interfaces/lokalized_core.Strings.html) instance with [`createStrings`](https://jsdoc.lokalized.com/1.0.0/functions/lokalized_core.createStrings.html). Supply the application's current language on each lookup. This factory accepts an app-owned getter, so changing language does not require reloading the files:

<!-- example: overview-books -->

```js
import { createStrings } from "lokalized";
import { readStringsFromDirectory } from "lokalized/node";

const { catalogs, warnings } = await readStringsFromDirectory("examples/readme/books");

function makeStrings(currentLocale) {
  return createStrings({
    localizedStringSupplier: () => catalogs,
    fallbackLocale: "pt-BR",
    localeSupplier: () => currentLocale(),
  });
}

// A demo setting; an application passes its own language-settings getter.
let appLocale = "pt-BR";
const strings = makeStrings(() => appLocale);
warnings.map((warning) => warning.missingLanguageForms); // => [["CARDINALITY_MANY"]]
```

The abbreviated book example covers `ONE` and `OTHER`. Portuguese also defines `MANY`, so the loader warns about the omitted form. Production files should define every required form; warnings identify gaps before an affected lookup fails.

For a browser, supply parsed objects or a verified fetch result instead of using `lokalized/node`; [see browser integration](#browser-integration). A server can pass a request-scoped language preference through per-invocation options.

By default, exhausted lookups return the key with available placeholders interpolated into it. Failure handlers can throw instead, or keep the key while reporting structured telemetry; [see failure handling](#translation-failure-handling). Load files and create the immutable instance once, then share it. To reload files, construct a new instance and let your application replace the shared snapshot.

### 3. Ask Strings Instance For Translations

<!-- example: overview-books -->

```js
strings.get("I read {{bookCount}} books.", { bookCount: 3 }); // => "Li 3 livros."
strings.get("I read {{bookCount}} books.", { bookCount: 1 }); // => "Li 1 livro."
strings.get("I read {{bookCount}} books.", { bookCount: 0 }); // => "Não li nenhum livro."
```

Lokalized selects `CARDINALITY_ONE` for 1 and `CARDINALITY_OTHER` for 3 in Brazilian Portuguese. The ordered alternative replaces the whole sentence at zero. None of those wording decisions belong in application conditionals.

#### Formatting Placeholder Values

Lokalized selects wording and interpolates values; it does not format dates, times, currency, or localized numbers. When a number drives selection and needs display formatting, pass a raw numeric placeholder and a separate formatted string.

<!-- example: overview-formatting -->

```js
const count = 12345;
const formattedCount = new Intl.NumberFormat("en-US").format(count);
formattedCount; // => "12,345"
// Supply { count, formattedCount } to a message whose rules use count
// and whose visible text uses {{formattedCount}}.
```

#### 4. Ensure Determinism via Tiebreakers

Suppose you load `en-US` and `en-GB`, and a user asks for `en-CA`. If no earlier exact, canonical, or CLDR-parent match applies, the configured English order decides which file wins. Construction rejects ambiguous primary languages unless the tiebreaker list includes every loaded locale for that language exactly once.

<!-- example: overview-tiebreakers -->

```js
import { createStrings } from "lokalized";

const regionalStrings = createStrings({
  localizedStringSupplier: () => ({ "en-US": { welcome: "Hello!" }, "en-GB": { welcome: "Welcome!" } }),
  fallbackLocale: "en-US",
  localeSupplier: () => "en-CA",
  tiebreakerLocalesByLanguageCode: { en: ["en-US", "en-GB"] },
});
regionalStrings.get("welcome"); // => "Hello!"
```

#### 5. Respect User Language Preferences

A web request might carry `Accept-Language: en-GB;q=1.0,en;q=0.75,fr-FR;q=0.25`. Lokalized can evaluate the weighted preference list against the loaded files. Missing, malformed, blank, or over-limit raw headers fall back safely; they are never truncated into a different preference list.

<!-- example: overview-books -->

```js
import { createLocaleMatcher, forAcceptLanguage } from "lokalized/negotiate";

const negotiator = createLocaleMatcher(strings.getLocaleConfiguration());
const options = forAcceptLanguage(negotiator, "pt-BR,pt;q=0.8");
strings.get("I read {{bookCount}} books.", { bookCount: 1 }, options); // => "Li 1 livro."
```

In a browser, [`chooseBrowserLocale`](https://jsdoc.lokalized.com/1.0.0/functions/lokalized_core.chooseBrowserLocale.html) matches the ordered [`navigator.languages`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages) list against the loaded locales, returning the configured fallback when none match. With a [plain script tag](#plain-script-tag), call `lokalized.chooseBrowserLocale(strings.getLocaleConfiguration())`; with ES modules, import `chooseBrowserLocale` from `lokalized`. Use the browser's choice as the initial language when your app has no saved language preference, then let the app's language settings control later lookups. Servers and jobs can use explicit per-call preferences. The [platform guide](Documentation/JAVASCRIPT-GUIDE.md#negotiating-from-accept-language) explains full-list negotiation and request-scoped use.

### Locale Matching Behavior

Matching is deterministic and follows the same broad rules across ports:

- Exact loaded tags win before CLDR-canonical-equivalent tags and legacy aliases.
- CLDR parent locales are considered before looser language-only matches: `en-AU` can prefer `en-001` before `en`.
- Matching is script-aware: `zh-TW` can match `zh-Hant`; `sr-Latn` and `sr-Cyrl` remain distinct.
- Norwegian `no` and Bokmål `nb` bridge as a compatibility fallback; exact files still win. Nynorsk `nn` is independent.
- Complete tiebreaker orders resolve otherwise ambiguous files for the same primary language.
- Weighted language ranges honor `q=0` exclusions when an acceptable loaded candidate remains.
- Unmatched requests, `und`, wildcard-only preferences, and empty lists resolve to the configured fallback.

| Request | Loaded files | Result |
|---|---|---|
| `en-AU` | `en-001`, `en` | `en-001` |
| `zh-TW` | `zh-Hant`, `zh-Hans` | `zh-Hant` |
| `en-CA` | `en-US`, `en-GB` | First configured English tiebreaker |

Parsed range lists are bounded at 32 entries. The raw-header helper bounds input at 4,096 UTF-16 code units. Pinned IANA equivalents may add ranges beyond the ones literally written in a header. Language-range equivalence comes from the IANA Language Subtag Registry snapshot (`File-Date: 2026-09-17`), rather than the host's locale database.

## Loading Localized Strings

Node.js loaders such as [`readStringsFromDirectory`](https://jsdoc.lokalized.com/1.0.0/functions/lokalized_node.readStringsFromDirectory.html) discover locale-named files in a directory and return both parsed `catalogs` and `warnings`. They do not recursively scan child directories. Process warnings at the load boundary instead of discarding them:

<!-- example: overview-loading -->

```js
import { readStringsFromDirectory } from "lokalized/node";

const loaded = await readStringsFromDirectory("examples/readme/books", {
  warningHandler: (warning) => console.warn(warning.message),
});
Object.keys(loaded.catalogs); // => ["pt-BR"]
```

Browser delivery uses [`lokalized/load`](https://jsdoc.lokalized.com/1.0.0/modules/lokalized_load.html): parse a manifest, fetch the required locale set, verify SHA-256 digests, and provide the resulting catalogs to `createStrings`. A manifest's fingerprints verify byte identity; a trusted publishing origin or app-owned identity pin supplies authenticity. The [platform guide](Documentation/JAVASCRIPT-GUIDE.md#over-the-network-browser-edge-or-server) has the complete fetch and SSR hand-off flows.

Loading is bounded per input and per aggregate load. Malformed UTF-8/JSON, duplicate members, invalid expressions, and invalid localized strings fail validation. A blank or BOM-only file is invalid; use `{}` for an intentionally empty file. Missing locale-specific plural forms produce structured warnings; they are not silently filled from an unrelated language.

## Per-Invocation Options

The configured locale supplier is useful for an app's shared language settings. For independent views, requests, batch jobs, or alternate output sinks, override the language for one call with [`forLocale`](https://jsdoc.lokalized.com/1.0.0/functions/lokalized_core.forLocale.html):

<!-- example: overview-books -->

```js
import { forLocale } from "lokalized/core";

strings.get("I read {{bookCount}} books.", { bookCount: 1 }, forLocale("pt-BR")); // => "Li 1 livro."
```

Per-call options can also override language ranges, an existing match, bidi isolation, fallback policy, failure handling, or successful-fallback observation. An explicit locale or match bypasses the configured locale supplier for that call. A per-call observer replaces the instance observer; omission inherits it.

## Runtime Safety Limits

Evaluation bounds cover numeric precision and scale, expression length and nesting, generated-fragment depth, interpolated output, and cumulative expansion per locale attempt. Defaults include 1,024 numeric digits, 2,048 expression characters, 256 expression tokens, 32 nested groups, 32 fragment levels, and 262,144 UTF-16 units for an interpolated result.

JavaScript v1 fixes these runtime limits; loader `limits` can lower resource budgets. See the [platform guide](Documentation/JAVASCRIPT-GUIDE.md#limits) for supported names and refusal behavior.

## A More Complex Example

Lokalized handles phrases whose wording changes according to several language rules. In English, gender affects the subject fragment. In Spanish, it also changes words such as `uno`/`una`, `los`/`las`, and `jugadores`/`jugadoras`. A common-gender alternative can rewrite the phrase naturally, rather than inventing one opaque flag per combination.

### English Localized Strings File

Save this as `examples/readme/players/en.json`:

<!-- catalog: examples/readme/players/en.json -->

```json
{
  "{{heOrShe}} was one of the {{groupSize}} best baseball players.": {
    "translation": "{{heOrShe}} was one of the {{groupSize}} best baseball players.",
    "placeholders": {
      "heOrShe": {
        "value": "heOrShe",
        "translations": {
          "GENDER_MASCULINE": "He",
          "GENDER_FEMININE": "She",
          "GENDER_COMMON": "This person"
        }
      }
    },
    "alternatives": [
      {
        "groupSize <= 1": "{{heOrShe}} was the best baseball player."
      }
    ]
  }
}
```

### Spanish Localized Strings File

Save this as `examples/readme/players/es-MX.json`:

<!-- catalog: examples/readme/players/es-MX.json -->

```json
{
  "{{heOrShe}} was one of the {{groupSize}} best baseball players.": {
    "translation": "Fue {{uno}} de {{los}} {{groupSize}} mejores {{jugadores}} de béisbol.",
    "placeholders": {
      "uno": {
        "value": "heOrShe",
        "translations": {
          "GENDER_MASCULINE": "uno",
          "GENDER_FEMININE": "una"
        }
      },
      "los": {
        "value": "heOrShe",
        "translations": {
          "GENDER_MASCULINE": "los",
          "GENDER_FEMININE": "las"
        }
      },
      "jugadores": {
        "value": "heOrShe",
        "translations": {
          "GENDER_MASCULINE": "jugadores",
          "GENDER_FEMININE": "jugadoras"
        }
      }
    },
    "alternatives": [
      {
        "heOrShe == GENDER_COMMON && groupSize <= 1": "Esta persona era quien mejor jugaba al béisbol."
      },
      {
        "heOrShe == GENDER_COMMON": "Esta persona estaba entre las {{groupSize}} personas que mejor jugaban al béisbol."
      },
      {
        "heOrShe == GENDER_MASCULINE && groupSize <= 1": "Él era el mejor jugador de béisbol."
      },
      {
        "heOrShe == GENDER_FEMININE && groupSize <= 1": "Ella era la mejor jugadora de béisbol."
      }
    ]
  }
}
```

### The Rules, Exercised

The application supplies gender and group size. The files own the wording decisions:

<!-- example: overview-players -->

```js
import { createStrings } from "lokalized";
import { readStringsFromDirectory } from "lokalized/node";

const { catalogs } = await readStringsFromDirectory("examples/readme/players");
const playersStrings = createStrings({
  localizedStringSupplier: () => catalogs,
  fallbackLocale: "en",
  localeSupplier: () => "en",
});

import { GENDER_MASCULINE, GENDER_FEMININE, GENDER_COMMON } from "lokalized";
import { forLocale } from "lokalized/core";

const key = "{{heOrShe}} was one of the {{groupSize}} best baseball players.";
playersStrings.get(key, { heOrShe: GENDER_MASCULINE, groupSize: 10 }); // => "He was one of the 10 best baseball players."
playersStrings.get(key, { heOrShe: GENDER_FEMININE, groupSize: 1 }); // => "She was the best baseball player."
playersStrings.get(key, { heOrShe: GENDER_FEMININE, groupSize: 10 }, forLocale("es-MX")); // => "Fue una de las 10 mejores jugadoras de béisbol."
playersStrings.get(key, { heOrShe: GENDER_COMMON, groupSize: 1 }, forLocale("es-MX")); // => "Esta persona era quien mejor jugaba al béisbol."
```

## Cardinality Ranges

A range has its own plural agreement. The result is selected from the start and end categories using pinned CLDR plural-range rules; selecting from the end alone can be wrong. English `0–1` selects `OTHER`, even though the ending value alone selects `ONE`. French selects `ONE` for the same range.

### French Localized Strings File

Save this as `examples/readme/ranges/fr.json`:

<!-- catalog: examples/readme/ranges/fr.json -->

```json
{
  "The meeting will be {{minHours}}-{{maxHours}} hours long.": {
    "translation": "La réunion aura une durée de {{minHours}} à {{maxHours}} {{heures}}.",
    "placeholders": {
      "heures": {
        "range": {
          "start": "minHours",
          "end": "maxHours"
        },
        "translations": {
          "CARDINALITY_ONE": "heure",
          "CARDINALITY_OTHER": "heures"
        }
      }
    }
  }
}
```

### English Localized Strings File

Save this as `examples/readme/ranges/en.json`:

<!-- catalog: examples/readme/ranges/en.json -->

```json
{
  "The meeting will be {{minHours}}-{{maxHours}} hours long.": {
    "translation": "The meeting will be {{minHours}}-{{maxHours}} {{hours}} long.",
    "placeholders": {
      "hours": {
        "range": {
          "start": "minHours",
          "end": "maxHours"
        },
        "translations": {
          "CARDINALITY_ONE": "hour",
          "CARDINALITY_OTHER": "hours"
        }
      }
    }
  }
}
```

### Cardinality Ranges, Exercised

<!-- example: overview-ranges -->

```js
import { createStrings } from "lokalized";
import { readStringsFromDirectory } from "lokalized/node";

import { cardinalRangeData } from "lokalized/data/ranges";

const { catalogs } = await readStringsFromDirectory("examples/readme/ranges");
const rangeStrings = createStrings({
  localizedStringSupplier: () => catalogs,
  fallbackLocale: "en",
  localeSupplier: () => "en",
  pluralData: { ranges: cardinalRangeData },
});

import { forLocale } from "lokalized/core";
rangeStrings.get("The meeting will be {{minHours}}-{{maxHours}} hours long.", { minHours: 0, maxHours: 1 }, forLocale("fr")); // => "La réunion aura une durée de 0 à 1 heure."
```

Import `cardinalRangeData` explicitly. The root entry point does not include optional ordinal or range tables in browser bundles.

## Ordinal Forms

Ordinality describes position: English distinguishes `1st`, `2nd`, `3rd`, and `4th`. Languages can combine ordinal choice with gender and whole-message alternatives.

### English Localized Strings File

Save this as `examples/readme/ordinals/en.json`:

<!-- catalog: examples/readme/ordinals/en.json -->

```json
{
  "{{hisOrHer}} {{year}}th birthday party is next week.": {
    "translation": "{{hisOrHer}} {{year}}{{ordinal}} birthday party is next week.",
    "placeholders": {
      "hisOrHer": {
        "value": "hisOrHer",
        "translations": {
          "GENDER_MASCULINE": "His",
          "GENDER_FEMININE": "Her"
        }
      },
      "ordinal": {
        "value": "year",
        "translations": {
          "ORDINALITY_ONE": "st",
          "ORDINALITY_TWO": "nd",
          "ORDINALITY_FEW": "rd",
          "ORDINALITY_OTHER": "th"
        }
      }
    }
  }
}
```

### Spanish Localized Strings File

Save this as `examples/readme/ordinals/es.json`:

<!-- catalog: examples/readme/ordinals/es.json -->

```json
{
  "{{hisOrHer}} {{year}}th birthday party is next week.": {
    "translation": "Su fiesta de cumpleaños número {{year}} es la próxima semana.",
    "alternatives": [
      {
        "year == 1": "Su primera fiesta de cumpleaños es la próxima semana."
      },
      {
        "hisOrHer == GENDER_FEMININE && year == 15": "Su quinceañera es la próxima semana."
      }
    ]
  }
}
```

### Ordinals, Exercised

<!-- example: overview-ordinals -->

```js
import { createStrings } from "lokalized";
import { readStringsFromDirectory } from "lokalized/node";

import { ordinalData } from "lokalized/data/ordinal";

const { catalogs } = await readStringsFromDirectory("examples/readme/ordinals");
const ordinalStrings = createStrings({
  localizedStringSupplier: () => catalogs,
  fallbackLocale: "en",
  localeSupplier: () => "en",
  pluralData: { ordinal: ordinalData },
});

import { GENDER_FEMININE } from "lokalized";
ordinalStrings.get("{{hisOrHer}} {{year}}th birthday party is next week.", { hisOrHer: GENDER_FEMININE, year: 2 }); // => "Her 2nd birthday party is next week."
```

Import `ordinalData` for ordinal placeholders or expressions. Use `pluralData: { ordinal: ordinalData, ranges: cardinalRangeData }` when you need both; see the [platform guide](Documentation/JAVASCRIPT-GUIDE.md#ordinals-and-ranges-are-opt-in-and-the-option-has-a-name).

## Language Forms

Language forms are typed runtime values. The JSON tokens are shared across every port:

| Axis | Example catalog token | What it controls |
|---|---|---|
| Gender | `GENDER_FEMININE` | Gender agreement |
| Grammatical case | `CASE_DATIVE` | A noun's role in a sentence |
| Definiteness | `DEFINITENESS_DEFINITE` | Definite, indefinite, or construct forms |
| Classifier | `CLASSIFIER_PERSON` | Counting categories |
| Formality | `FORMALITY_FORMAL` | Register and address |
| Clusivity | `CLUSIVITY_INCLUSIVE` | Whether “we” includes the listener |
| Animacy | `ANIMACY_ANIMATE` | Animate or inanimate agreement |
| Plural cardinality | `CARDINALITY_ONE` | Quantity-dependent wording |
| Plural cardinality range | Start/end cardinality pair | Agreement for a numeric range |
| Phonetics | `PHONETIC_VOWEL` | Pronunciation-sensitive wording |
| Ordinality | `ORDINALITY_TWO` | Position-dependent wording |

Ranges combine cardinalities; there are ten distinct language-form axes. Numeric values automatically select cardinal or ordinal categories when required. Gender, case, formality, and the other authored forms come from the application; Lokalized does not infer them from a person's name or identity.

<!-- example: overview-forms -->

```js
import { GENDER_FEMININE, CASE_DATIVE, FORMALITY_FORMAL } from "lokalized";

GENDER_FEMININE.axis; // => "gender"
CASE_DATIVE.axis; // => "grammatical-case"
FORMALITY_FORMAL.axis; // => "formality"
// Pass these values, not strings such as "GENDER_FEMININE".
```

Written decimals and explicit plural operands retain numeric meaning, including visible fraction digits and compact exponents. English `1` selects `ONE`, while a decimal written as `1.00` selects `OTHER`. Keep raw numeric inputs separate from localized display strings.

### Gender

Gender is a grammatical input, supplied explicitly as a typed value. The baseball example above combines it with a group size so the file can rewrite both a pronoun and a whole sentence.

The following Node.js examples reuse this helper. Browser apps provide the same JSON as objects or verified loaded catalogs:

<!-- example: overview-axes -->

```js
import { createStrings, CASE_DATIVE, DEFINITENESS_DEFINITE, CLASSIFIER_BOUND,
  FORMALITY_CASUAL, FORMALITY_FORMAL, CLUSIVITY_INCLUSIVE, CLUSIVITY_EXCLUSIVE,
  ANIMACY_ANIMATE, ANIMACY_INANIMATE } from "lokalized";
import { readStringsFromDirectory } from "lokalized/node";

async function formsFromDirectory(path, locale) {
  const { catalogs } = await readStringsFromDirectory(path);
  return createStrings({ localizedStringSupplier: () => catalogs,
    localeSupplier: () => locale, fallbackLocale: locale });
}
```

### Grammatical Case

Case selects the form required by the sentence. This Russian example supplies a dative recipient instead of teaching the application how to inflect a name.

Save this as `examples/readme/case/ru.json`:

<!-- catalog: examples/readme/case/ru.json -->

```json
{
  "Send a message to the recipient.": {
    "translation": "Отправить сообщение {{recipientForm}}.",
    "placeholders": {
      "recipientForm": {
        "value": "grammaticalCase",
        "translations": {
          "CASE_NOMINATIVE": "Иван",
          "CASE_DATIVE": "Ивану",
          "CASE_ACCUSATIVE": "Ивана"
        }
      }
    }
  }
}
```

<!-- example: overview-axes -->

```js
const caseStrings = await formsFromDirectory("examples/readme/case", "ru");
caseStrings.get("Send a message to the recipient.", { grammaticalCase: CASE_DATIVE }); // => "Отправить сообщение Ивану."
```

### Definiteness

Definiteness distinguishes definite, indefinite, and construct forms. The file owns the Arabic noun phrase. This plain-text demonstration disables bidi isolation; normal UI lookups retain the default isolation policy.

Save this as `examples/readme/definiteness/ar.json`:

<!-- catalog: examples/readme/definiteness/ar.json -->

```json
{
  "Open the document.": {
    "translation": "افتح {{documentForm}}.",
    "placeholders": {
      "documentForm": {
        "value": "definiteness",
        "translations": {
          "DEFINITENESS_DEFINITE": "الكتاب",
          "DEFINITENESS_INDEFINITE": "كتابًا",
          "DEFINITENESS_CONSTRUCT": "كتاب"
        }
      }
    }
  }
}
```

<!-- example: overview-axes -->

```js
const definiteStrings = await formsFromDirectory("examples/readme/definiteness", "ar");
definiteStrings.get("Open the document.", { definiteness: DEFINITENESS_DEFINITE }, { bidiIsolation: "none" }); // => "افتح الكتاب."
```

### Classifiers

Many languages count objects with a classifier or counter. The application identifies the kind of object; the Japanese file chooses the counter for bound items such as books.

Save this as `examples/readme/classifiers/ja.json`:

<!-- catalog: examples/readme/classifiers/ja.json -->

```json
{
  "I bought {{count}} items.": {
    "translation": "{{count}}{{counter}}買いました。",
    "placeholders": {
      "counter": {
        "value": "classifier",
        "translations": {
          "CLASSIFIER_GENERAL": "つ",
          "CLASSIFIER_BOUND": "冊",
          "CLASSIFIER_MACHINE": "台"
        }
      }
    }
  }
}
```

<!-- example: overview-axes -->

```js
const classifierStrings = await formsFromDirectory("examples/readme/classifiers", "ja");
classifierStrings.get("I bought {{count}} items.", { count: 3, classifier: CLASSIFIER_BOUND }); // => "3冊買いました。"
```

### Formality

Formality selects the appropriate register without a switch statement in the calling code. These labels describe authored wording; they are not universal rules about when to address someone formally.

Save this as `examples/readme/formality/en.json`:

<!-- catalog: examples/readme/formality/en.json -->

```json
{
  "Hello, {{name}}.": {
    "translation": "{{greeting}}, {{name}}.",
    "placeholders": {
      "greeting": {
        "value": "formality",
        "translations": {
          "FORMALITY_CASUAL": "Hey",
          "FORMALITY_INFORMAL": "Hi",
          "FORMALITY_FORMAL": "Hello",
          "FORMALITY_HUMBLE": "I humbly greet you",
          "FORMALITY_HONORIFIC": "Greetings"
        }
      }
    }
  }
}
```

<!-- example: overview-axes -->

```js
const formalStrings = await formsFromDirectory("examples/readme/formality", "en");
formalStrings.get("Hello, {{name}}.", { name: "Ada", formality: FORMALITY_CASUAL }); // => "Hey, Ada."
formalStrings.get("Hello, {{name}}.", { name: "Ada", formality: FORMALITY_FORMAL }); // => "Hello, Ada."
```

### Clusivity

Inclusive “we” includes the listener; exclusive “we” does not. Malay distinguishes these with different words, selected here from the same key.

Save this as `examples/readme/clusivity/ms.json`:

<!-- catalog: examples/readme/clusivity/ms.json -->

```json
{
  "We will meet at noon.": {
    "translation": "{{we}} akan bertemu pada tengah hari.",
    "placeholders": {
      "we": {
        "value": "clusivity",
        "translations": {
          "CLUSIVITY_INCLUSIVE": "Kita",
          "CLUSIVITY_EXCLUSIVE": "Kami"
        }
      }
    }
  }
}
```

<!-- example: overview-axes -->

```js
const clusiveStrings = await formsFromDirectory("examples/readme/clusivity", "ms");
clusiveStrings.get("We will meet at noon.", { clusivity: CLUSIVITY_INCLUSIVE }); // => "Kita akan bertemu pada tengah hari."
clusiveStrings.get("We will meet at noon.", { clusivity: CLUSIVITY_EXCLUSIVE }); // => "Kami akan bertemu pada tengah hari."
```

### Animacy

Animacy affects agreement and inflection in languages such as Russian. The caller supplies the grammatical category; the translation selects the corresponding phrase.

Save this as `examples/readme/animacy/ru.json`:

<!-- catalog: examples/readme/animacy/ru.json -->

```json
{
  "I see {{object}}.": {
    "translation": "Я вижу {{object}}.",
    "placeholders": {
      "object": {
        "value": "animacy",
        "translations": {
          "ANIMACY_ANIMATE": "брата",
          "ANIMACY_INANIMATE": "стол"
        }
      }
    }
  }
}
```

<!-- example: overview-axes -->

```js
const animacyStrings = await formsFromDirectory("examples/readme/animacy", "ru");
animacyStrings.get("I see {{object}}.", { animacy: ANIMACY_ANIMATE }); // => "Я вижу брата."
animacyStrings.get("I see {{object}}.", { animacy: ANIMACY_INANIMATE }); // => "Я вижу стол."
```

### Plural Cardinality

Numeric quantities select `ZERO`, `ONE`, `TWO`, `FEW`, `MANY`, or `OTHER` according to the locale's CLDR rules. Languages use different subsets: Japanese uses only `OTHER`, English uses `ONE` and `OTHER`, and Russian distinguishes `ONE`, `FEW`, `MANY`, and `OTHER`. Never assume that a language has only singular and plural forms.

### Plural Cardinality Ranges

Range agreement uses both endpoint categories. See the [French and English examples](#cardinality-ranges); do not substitute the ending number's category for the range's category.

### Phonetics

For phrases such as *a gift* and *an honor*, an application-supplied resolver maps runtime text to a typed pronunciation category. The translation file decides the article:

Save this as `examples/readme/phonetics/en.json`:

<!-- catalog: examples/readme/phonetics/en.json -->

```json
{
  "I received a {{noun}}.": {
    "translation": "I received {{article}} {{noun}}.",
    "placeholders": {
      "article": {
        "value": "noun",
        "translations": {
          "PHONETIC_VOWEL": "an",
          "PHONETIC_CONSONANT": "a"
        }
      }
    }
  }
}
```

<!-- example: overview-phonetics -->

```js
import { createStrings } from "lokalized";
import { readStringsFromDirectory } from "lokalized/node";

import { PHONETIC_VOWEL, PHONETIC_CONSONANT } from "lokalized";

const { catalogs } = await readStringsFromDirectory("examples/readme/phonetics");
const phoneticStrings = createStrings({
  localizedStringSupplier: () => catalogs,
  fallbackLocale: "en",
  localeSupplier: () => "en",
  // This demo knows two terms. Production resolvers use pronunciation data.
  phoneticResolver: (term) => term === "honor" ? PHONETIC_VOWEL : PHONETIC_CONSONANT,
});

phoneticStrings.get("I received a {{noun}}.", { noun: "honor" }); // => "I received an honor."
phoneticStrings.get("I received a {{noun}}.", { noun: "gift" }); // => "I received a gift."
```

The resolver receives the term and locale. Categories also cover silent/aspirated *h*, Italian initial clusters, Spanish stressed *a*, and Arabic sun/moon letters. Pronunciation is not reliably determined by a naive first-letter test.

### Ordinals

Ordinals express position rather than quantity. English uses `ONE`, `TWO`, `FEW`, and `OTHER` for suffixes such as 1st, 2nd, 3rd, and 4th; Spanish uses only `OTHER` in its ordinal rules. See the [birthday example](#ordinal-forms) for both files and the calling API.

## CLDR Data

Cardinal, ordinal, range, matching, and bidi behavior use pinned CLDR 48.2 data. Updating the host's formatting libraries does not silently change Lokalized's plural decisions. IANA locale equivalence and Unicode data are pinned as well. Generated runtime data is checked in; applications do not run generators or download reference archives.

For development, see [data provenance](src/data/provenance.js), [NOTICE](NOTICE), and the [JavaScript platform guide](Documentation/JAVASCRIPT-GUIDE.md#coming-from-lokalized-java). The JavaScript reference baseline is Java 3.1.0; later Java API additions are separately recorded in [DIVERGENCES.md](DIVERGENCES.md).

## Translation Failure Handling

The default handler returns the key after an exhausted lookup. Fail-fast applications can throw; fail-soft applications can record telemetry while returning the key. Parser, configuration, and application callback errors still propagate rather than being turned into successful translations.

<!-- example: overview-books -->

```js
import { THROW_EXCEPTION, RETURN_KEY } from "lokalized/core";

const strict = createStrings({
  localizedStringSupplier: () => catalogs,
  fallbackLocale: "pt-BR", localeSupplier: () => "pt-BR",
  translationFailureHandler: () => THROW_EXCEPTION,
});
let failed = false;
try { strict.get("not-authored"); } catch { failed = true; }
failed; // => true

const observed = [];
const failSoft = createStrings({
  localizedStringSupplier: () => catalogs,
  fallbackLocale: "pt-BR", localeSupplier: () => "pt-BR",
  translationFailureHandler: (failure) => { observed.push(failure.reason); return RETURN_KEY; },
});
failSoft.get("not-authored"); // => "not-authored"
observed; // => ["missing-translation"]
```

Fallback policy decides whether a failed candidate permits trying another locale. The default continues for a missing translation or unmatched alternative and stops on resolution failure. A permissive policy can try another locale for any failure; a never-fallback policy stops after the first attempt.

### Observing Successful Fallback

A successful translation from a later candidate is not an exhausted failure. Attach a `translationFallbackObserver` to record this separately. The event identifies the lookup locale, retained match, attempted locales, resolved locale, key, and preceding failures. Observer errors propagate directly; they do not resume the fallback walk.

### Failure Reasons

- `missing-translation`: the candidate has no entry for the key.
- `no-matching-alternative`: an alternatives-only entry has no selected branch.
- `resolution-failure`: a selected entry cannot be evaluated or rendered.

## Translation Diagnostics

[`get`](https://jsdoc.lokalized.com/1.0.0/interfaces/lokalized_core.Strings.html#get) returns text. [`getResult`](https://jsdoc.lokalized.com/1.0.0/interfaces/lokalized_core.Strings.html#getresult) also reports how the key was resolved, including the matched and resolved locales, fallback status, outcome status, and any retained failure. Negotiation and per-key fallback are separate: the file chosen for the user may lack a key that exists in a later candidate.

<!-- example: overview-books -->

```js
const result = strings.getResult("I read {{bookCount}} books.", { bookCount: 3 });
result.translation; // => "Li 3 livros."
result.resolvedLocale; // => "pt-BR"
result.status; // => "translated"
result.isFallback; // => false
```

Structured load warnings include source, locale, key, placeholder, missing forms, and a human-readable message where applicable. Render translated values using your UI's normal text and escaping APIs. Lokalized does not escape HTML, create markup, or choose page-level `lang` and `dir` for your application. Bidi isolation protects interpolated fragments without changing the language-selection API.

## Localized Strings File Format

### Structure

- UTF-8, with a BCP 47 filename such as `en.json` or `zh-TW.json`; do not provide both suffixed and unsuffixed files for one locale.
- One top-level JSON object whose keys are translation keys.
- A value can be a string or an object with `translation`, `commentary`, `placeholders`, and `alternatives`.
- An object needs a `translation` or at least one alternative. A default translation is optional when every valid outcome is selected by alternatives.

The shorthand `"welcome": "Hello!"` is equivalent to `"welcome": { "translation": "Hello!" }`.

### JSON Schema

The shared [JSON Schema](https://github.com/lokalized/lokalized-java/blob/master/src/main/resources/schema/lokalized-strings.schema.json) documents file structure and language-form names. Runtime parsing additionally validates expressions and resource budgets. A missing locale-specific plural form produces a warning and may later cause a resolution failure; it is not evidence that the locale needs only the forms the author happened to include.

### Commentary

`commentary` holds translator-facing context and is never rendered. Document where a message appears and what each application-supplied placeholder means.

### Placeholders

Write `{{bookCount}}`, with no spaces inside the braces. Names start with a Unicode letter or underscore and continue with letters, numbers, combining marks, underscores, or hyphens. The ASCII subset `[A-Za-z_][A-Za-z0-9_-]*` is portable across the ports and schema engines.

A generated placeholder can select by language form, use a start/end pair for a cardinality range, or select an expression-driven fragment. Generated placeholders can refer to other generated fragments. Parent definitions are inherited by selected alternatives unless the child replaces them. Authored keys and placeholder identifiers retain exact Unicode identity.

#### Alternatives

Alternatives are ordered: the first true predicate wins. They can replace a whole message or a generated fragment. This search message combines a result count, a runtime limit, and elapsed time without making the app compute wording buckets:

Save this as `examples/readme/search/en.json`:

<!-- catalog: examples/readme/search/en.json -->

```json
{
  "Search completed.": {
    "translation": "Found {{resultSummary}} {{timing}}.",
    "placeholders": {
      "resultSummary": {
        "translation": "{{formattedResultCount}} {{resultNoun}}",
        "alternatives": [
          {
            "resultCount == 0": "no results"
          },
          {
            "resultCount >= resultLimit": "at least {{formattedResultLimit}} results"
          }
        ]
      },
      "timing": {
        "translation": "in {{formattedDuration}}",
        "alternatives": [
          {
            "elapsedMilliseconds < 1000": "instantly"
          }
        ]
      },
      "resultNoun": {
        "value": "resultCount",
        "translations": {
          "CARDINALITY_ONE": "result",
          "CARDINALITY_OTHER": "results"
        }
      }
    }
  }
}
```

<!-- example: overview-search -->

```js
import { createStrings } from "lokalized";
import { readStringsFromDirectory } from "lokalized/node";

const { catalogs } = await readStringsFromDirectory("examples/readme/search");
const searchStrings = createStrings({
  localizedStringSupplier: () => catalogs,
  fallbackLocale: "en",
  localeSupplier: () => "en",
});

const message = searchStrings.get("Search completed.", {
  resultCount: 100, resultLimit: 100, elapsedMilliseconds: 250,
  formattedResultCount: "100", formattedResultLimit: "100", formattedDuration: "0.25 seconds",
});
message; // => "Found at least 100 results instantly."
```

#### Placeholder Scope and Inheritance

A selected child alternative inherits generated-placeholder definitions from its ancestors and overrides same-named definitions locally. Generated values become available to other fragments as they are resolved; missing data or cycles produce structured resolution failures. Local rules can override a fragment while retaining the surrounding sentence.

### Recursive Alternatives

An alternative can contain another translation object, including its own placeholders and alternatives. This lets translators express sparse exceptions and nested agreement without duplicating every complete sentence. Nesting and cumulative expansion remain bounded.

#### Expression Language

```text
gender == GENDER_MASCULINE && (bookCount > 10 || magazineCount > 20)
resultCount >= resultLimit && elapsedMilliseconds < 1000
```

Numeric comparisons support `<`, `>`, `<=`, `>=`, `==`, and `!=`. Language-form comparisons support `==` and `!=`. `&&` binds more tightly than `||`; parentheses override precedence. Numbers can be compared with plural categories when the expression requires cardinality or ordinality. Built-in language-form names are reserved constants.

#### What Expressions Currently Support

- Bounded infix expressions and nested groups.
- Comparisons between numeric literals, supported language forms, and runtime variables.
- Cross-field comparisons and compound predicates over raw application facts.

#### What Expressions Do Not Currently Support

- Unary `!`, string or Boolean literals, or explicit `null` operands.
- Textual equality between raw strings.
- Functions or arbitrary computed return values.
- A range-expression construct; use a start/end placeholder definition for plural-range selection.

## Inspection

Immutable inspection APIs expose the fallback and supported locales, tiebreaker orders, configured callbacks/policies, plural-data identity, and authored localized strings. Use these for auditing and tooling rather than mutating a runtime after construction.

## Keying Strategy

### Natural Language Keys

`"I read {{bookCount}} books."` is readable in application code, carries translator context, and makes the default return-key behavior useful. Editing the source copy changes the key, so translations need coordinated updates.

### Contextual Keys

`"Checkout.Title"` is stable when visible copy changes and distinguishes product contexts. Add commentary so translators understand its meaning; a returned contextual key is usually an obvious failure.

### Or — Mix Both!

Use natural-language keys where they help, and contextual keys for legal copy, reused wording, or other surfaces that need stable identifiers.

## Comparing Localization Formats

Lokalized, [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/), [MessageFormat 2](https://messageformat.unicode.org/docs/reference/matchers/), [Fluent](https://projectfluent.org/fluent/guide/selectors.html), and [gettext](https://www.gnu.org/software/gettext/manual/gettext.html) handle variable substitution and ordinary plurals. The differences become useful when several runtime facts jointly control wording.

### A Common Baseline: Plural Selection

```text
{bookCount, plural, one {I read # book.} other {I read # books.}}
```

Every compared format handles this ordinary case. Lokalized separates the sentence shape from the plural fragment, using the same JSON files across languages and platforms.

### Where Lokalized Goes Further Out of the Box

| Concern | Lokalized's built-in approach |
|---|---|
| Sparse compound rules | Ordered predicates combine thresholds, typed forms, parentheses, and cross-field comparisons. |
| Grammatical vocabulary | Ten typed axes shared by the files and application APIs. |
| Cardinality ranges | Pinned CLDR agreement selected from both endpoints. |
| Phonetic agreement | An application resolver supplies a typed onset category; the file owns the wording. |
| Runtime guarantees | Bounded evaluation, structured diagnostics, deterministic matching, immutable catalogs, reusable runtimes, and zero runtime dependencies. |

ICU uses nested selectors, MF2 supports multi-selector variants, Fluent uses select expressions, and gettext supplies plural selection and contextual keys. Equivalent output is possible through extensions or application logic. Cross-field inequalities such as `resultCount >= resultLimit` typically require precomputed selectors, a custom function, or branching outside those formats' stock selectors.

### Where Lokalized's Approach Shines

- Several raw runtime facts control wording, as in the search example above.
- A normal default translation needs a few compound exceptions or whole-phrase rewrites.
- Case, gender, register, phonetics, or range agreement are part of the product's actual copy requirements.
- Translators should own those language rules while the application supplies facts and owns business decisions.

See the [website's worked comparisons](https://www.lokalized.com/?platform=javascript#lokalized-approach-shines) for search limits, inventory conditions, and duration ranges.

## Language Reference

The [language reference](https://www.lokalized.com/languages/?platform=javascript) covers canonical CLDR plural-rule locales and common exact-tag profiles. It explains cardinalities, cardinality ranges, ordinalities, inherited rule sources, and localized strings filenames. `pt-PT`, for example, can have different rules from `pt`; tags such as `en-US` inherit the applicable plural rules while still allowing regional wording.

Plural categories do not translate words. Supply idiomatic copy for each category and keep incomplete-form warnings visible during authoring.

## About

Lokalized was created by [Mark Allen](https://www.revetkn.com). Development is sponsored by [Transmogrify LLC](https://www.xmog.com) and [Revetware LLC](https://www.revetware.com).

## Browser Integration

### Plain Script Tag

The [https://cdn.jsdelivr.net/npm/lokalized@1.0.0/dist/browser/lokalized.global.js](https://cdn.jsdelivr.net/npm/lokalized@1.0.0/dist/browser/lokalized.global.js) script exposes `window.lokalized`, with no module imports, npm installation, Node.js server, or build step required:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Lokalized example</title>
  </head>
  <body>
    <p id="welcome"></p>
    <script src="https://cdn.jsdelivr.net/npm/lokalized@1.0.0/dist/browser/lokalized.global.js"></script>
    <script>
      const strings = lokalized.createStrings({
        localizedStringSupplier: () => ({
          en: { welcome: "Hello, {{name}}!" },
          fr: { welcome: "Bonjour, {{name}}!" },
        }),
        fallbackLocale: "en",
        localeSupplier: () => document.documentElement.lang || "en",
      });

      // Start with the browser's preferred language among the loaded translations
      document.documentElement.lang =
        lokalized.chooseBrowserLocale(strings.getLocaleConfiguration());
      document.querySelector("#welcome").textContent = strings.get("welcome", { name: "Ada" });
    </script>
  </body>
</html>
```

The example selects an initial language from `navigator.languages`, with English as the fallback, and sets `<html lang="…">` accordingly. If your app has a saved language preference, use that instead of the browser's choice. The supplier reads the page language on each lookup, so later lookups use the updated language after your app's language picker changes it. This example displays `Hello, Ada!` in English and `Bonjour, Ada!` in French.

You can also serve `dist/browser/lokalized.global.js` from your own site. The single file includes all browser-safe functionality: root methods such as `lokalized.createStrings`, plus namespaces such as `lokalized.load`, `lokalized.negotiate`, and `lokalized.ssr`. Pin an exact package version when using a CDN.

### ES Modules

Save this HTML on a static host. The catalog is inline; no Node.js server, manifest, or build step is required. The browser preferences select among loaded locales, with English as fallback:

<!-- example: overview-browser -->

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Lokalized example</title>
<p id="welcome"></p>
<script type="module">
import { createStrings, chooseBrowserLocale } from "https://cdn.jsdelivr.net/npm/lokalized@1.0.0/dist/browser/lokalized.js";

const strings = createStrings({
  localizedStringSupplier: () => ({
    en: { welcome: "Hello, {{name}}!" },
    fr: { welcome: "Bonjour, {{name}} !" },
  }),
  fallbackLocale: "en",
  localeSupplier: () => chooseBrowserLocale(strings.getLocaleConfiguration()),
});
const greeting = strings.get("welcome", { name: "Ada" });
typeof greeting; // => "string"
document.querySelector("#welcome").textContent = greeting;
</script>
</html>
```

With a bundler, replace the CDN import with `import { createStrings, chooseBrowserLocale } from "lokalized"`. Put request-specific locale options on each server lookup rather than mutating one shared current-language variable.

The [JavaScript platform guide](Documentation/JAVASCRIPT-GUIDE.md) retains the full Node/browser walkthroughs, verified fetching, SSR and React Server Component boundaries, cache-key guidance, bidi/accessibility advice, CSP, entry-point and bundle tables, and the measured i18next comparison. [API.md](Documentation/API.md) documents the public API. Browse the [JavaScript API reference](https://jsdoc.lokalized.com/1.0.0/) or read how the [generated documentation](Documentation/API-REFERENCE.md) is built.
