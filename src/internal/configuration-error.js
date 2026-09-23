import { LOKALIZED_ERROR_TOKEN, LokalizedError } from "../internal/lokalized-error.js";

// @ts-check
/**
 * The library-owned failure for a configuration a caller supplied that cannot be honoured.
 *
 * EXTRACTED from `src/data/ordinal.js` when `lokalized/load` needed the same failure, because two
 * factories that must produce the SAME `name` and `code` are two dialects of one thing — and the one
 * that drifts is the one nobody is looking at. Plan 3.7 calls these construction-time
 * `ConfigurationError`s. The public catch-only hierarchy (`LokalizedError` and friends) is core's to
 * land; this carries the eventual `code` already, so that swap stays invisible to a consumer who
 * checks it.
 *
 * **IT IS A REAL CLASS AS OF S34, and the docblock above had already designed for the swap** — "the
 * public catch-only hierarchy is core's to land; this carries the eventual `code` already, so that
 * swap stays invisible to a consumer who checks it". It was a plain `Error` with `name` and `code`
 * assigned afterwards, so **119 call sites across `src/` produced a failure no `instanceof` could
 * recognise** — a consumer could only match it by string. That is the THIRD instance of exactly the
 * shape S22 fixed for `StringsLoadingError` and `DigestUnavailableError`, and the largest: it reaches
 * a caller from `core`, `load`, `ssr` and `node` alike.
 *
 * Plan 3.5:1100 declares it a package export, `const ConfigurationError:
 * CatchOnlyErrorClass<ConfigurationError>`, and :1107-1108 requires the runtime constructor to take
 * an unexported token so "plain-JavaScript direct construction and subclass instantiation fail
 * rather than creating partially initialized library errors". The FACTORY is what keeps the token
 * private while 119 sites raise one, the same arrangement `loadingError` and `parseError` use.
 *
 * `name` and `code` are unchanged, so the fourteen places that match on the string keep working —
 * measured before the change, and that is the whole point of the docblock's promise.
 */
  // Extends `LokalizedError` as of S35, so one `instanceof` answers "did this come from
  // lokalized" — plan 3.5:1039-1042 and :1092. The token travels up; it never leaves the package.
export class ConfigurationError extends LokalizedError {
  /**
   * **PRIVATE, WHICH IS HOW THE DECLARATION STOPS EXPOSING A CONSTRUCTOR.** Plan 3.5:1107-1108
   * requires the runtime constructor to take an unexported token AND the declaration to "expose no
   * constructor or extension signature". The token was there; the declaration was not — `tsc`
   * emitted `constructor(token: symbol, …)` for all five error classes, so a consumer's TypeScript
   * saw a constructible-looking class. `@private` emits `private constructor();`, which TypeScript
   * refuses to `new` AND refuses to extend: exactly the two properties the plan names. The static
   * raiser below is what lets the module's own factory still build one, since a private constructor
   * is callable only from inside the class body.
   *
   * @private @param {symbol} token the internal construction token @param {string} message */
  constructor(token, message) {
    if (token !== CONFIGURATION_ERROR_TOKEN)
      throw new TypeError("ConfigurationError is not constructible; it is thrown by lokalized");

    super(LOKALIZED_ERROR_TOKEN, "CONFIGURATION", message);
    /** @type {"ConfigurationError"} */
    this.name = "ConfigurationError";
  }

  /**
   * The one construction path, because the constructor above is private. Its parameters are the
   * constructor's, so the module's own factory keeps its types; a consumer cannot reach it, because
   * the token it takes first is never exported from this package.
   *
   * @param {symbol} token @param {string} message
   */
  static raise(token, message) {
    return new ConfigurationError(token, message);
  }
}

/** Unexported by design: only this package can hand it to the constructor. */
const CONFIGURATION_ERROR_TOKEN = Symbol("lokalized.ConfigurationError");

/**
 * @param {string} message
 * @returns {ConfigurationError}
 */
export function configurationError(message) {
  return ConfigurationError.raise(CONFIGURATION_ERROR_TOKEN, message);
}

/**
 * Refuse an option member this door does not know.
 *
 * **EVERY PUBLIC DOOR IGNORED AN UNKNOWN OPTION IN SILENCE.** It was
 * found four times one door at a time, each as a live defect in something else:
 * `createStrings({ limits })` running under the defaults, `loadStrings(…, { transport })` ignoring an
 * injected transport and going to THE REAL NETWORK, `createStringsManifestFromDirectory({ baseUrl })`
 * publishing a manifest the Fetch door then refuses, and `resolveLimits` reading seven named members
 * where Java's `LoadDiff.optionsFrom` throws. `test/option-surface.test.js` measured it as one
 * property rather than four anecdotes and pinned it; the maintainer then decided to refuse. How
 * many doors that is is derived there from the published declarations, not stated here.
 *
 * **THE NEAR MISS IS WHY THIS TAKES A TABLE AND NOT JUST A LIST.** The two sharpest cases are one
 * concept under two names — `createStrings` spells the load-time limits `loadingLimits` and
 * `parseStrings` spells them `limits` — and the two that cost real time did not fail at the call at
 * all. A refusal naming only the offending key turns a silent trap into a loud one; a refusal that
 * names the spelling the caller wanted turns it into a signpost. The table is DECLARED rather than
 * fuzzy-matched, and `test/option-surface.test.js` requires every entry to be a real near miss — a
 * name this door does not accept, and one that is real somewhere: an option at a sibling door, a
 * manifest member, or, for a name from another library's vocabulary, accepted by no door at all — and
 * compares the hints the doors actually emit with its declared table in both directions.
 *
 * **`Object.keys`, NEVER `Reflect.ownKeys`, AND THAT IS LOAD-BEARING.**
 * `test/candidate-chain-memo.test.js` passes `CANDIDATE_CHAIN_MEMO_DISABLED` — a SYMBOL — as an own
 * enumerable property, and `src/internal/locale.js` reads it. `Object.keys` returns string keys only,
 * so the symbol is admitted; `Reflect.ownKeys` would refuse it and red that file. An internal symbol
 * is not a caller's typo, so admitting it is correct and not merely convenient — but it is admitted
 * SILENTLY, which is why it is written down here.
 *
 * **A KEY PRESENT WITH AN UNDEFINED VALUE IS STILL REFUSED**, deliberately. `{ transport: maybe }`
 * where `maybe` is undefined is the same misspelling as `{ transport: fn }`, and a value-sensitive
 * rule would let exactly the dangerous case through on the days it happened to be unset.
 *
 * **`undefined`, `null` AND `false` MEAN "NO OPTIONS"; EVERY OTHER NON-OBJECT IS REFUSED, AND SO IS A
 * PROMISE** (see the check below) — the
 * maintainer's decision of 2026-09-23. Until then any non-object returned early here, and a review
 * measured what that let through: `loadStrings(manifest, "fr", myFetch)` — the transport handed over
 * bare instead of as `{ fetch }` — went to THE REAL NETWORK, `loadStringsFromFiles(m, l, myReader)`
 * used the default reader, and `get(key, values, "fr")` rendered the instance's language, all with no
 * error. `false` is admitted because `cond && { locale }` is how JavaScript writes an optional
 * argument; `0` and `""` arrive the same way from a numeric or string `cond` and are REFUSED, by the
 * decision's own terms (a number or a string is refused), which `test/option-surface.test.js` pins.
 *
 * **IT RETURNS THE OPTIONS, and a door whose options are optional takes them from here.** `null` was
 * never really "no options": eleven doors defaulted `options = {}`, which catches `undefined` only,
 * and then crashed on `null.limits` with a TypeError. The three "no options" values come back as one
 * frozen empty object, and EVERY door takes them from here — including the three that REQUIRE
 * options, which until the final review answered `undefined` and `null` with a host TypeError
 * ("Cannot read properties of null") and `false` with something else. Handed `{}`, each now gives
 * its own sentence for a missing option, the same for all three values.
 *
 * @template T
 * @param {string} door the public name a caller typed, which is what the message must say
 * @param {T} options
 * @param {readonly string[]} accepted every member this door reads, including via a helper it calls
 * @param {Readonly<Record<string, string>>} [nearMisses] wrong spelling -> the one that works here
 * @returns {Exclude<T, null | undefined | false>} the options, or an empty object for "no options"
 */
export function refuseUnknownOptions(door, options, accepted, nearMisses = {}) {
  if (options === undefined || options === null || options === false) return /** @type {any} */ (NO_OPTIONS);

  const takes = `It takes [${[...accepted].sort().join(", ")}]`;
  if (typeof options !== "object") {
    const handed = typeof options === "function" ? "a function"
      : typeof options === "string" ? `the string ${JSON.stringify(options.length > 40 ? `${options.slice(0, 40)}…` : options)}`
      : `the ${typeof options} ${String(options)}`;
    throw configurationError(`${door} takes an options object, and was handed ${handed}. ${takes}`);
  }

  // A PROMISE IS AN OBJECT, AND IT IS REFUSED ANYWAY (the maintainer's decision of 2026-09-23). The
  // realistic slip is a forgotten `await`: `loadStrings(manifest, "fr", loadConfig())` handed a
  // promise that has no own keys, so it read as "no options" and the load went to the global fetch
  // instead of the transport the promise would have carried. Any thenable is refused, not only a
  // native Promise, because `await` treats them alike.
  if (typeof (/** @type {any} */ (options)).then === "function")
    throw configurationError(`${door} takes an options object, and was handed a promise; await it first. ${takes}`);

  const unknown = Object.keys(options).filter((name) => !accepted.includes(name));
  if (unknown.length === 0) return /** @type {Exclude<T, null | undefined | false>} */ (options);

  const hints = unknown.filter((name) => name in nearMisses)
    .map((name) => `\`${name}\` is not the option name here; \`${nearMisses[name]}\` is`);
  throw configurationError(
    `${door} does not take the option(s) [${unknown.join(", ")}]. ` +
    (hints.length > 0 ? `${hints.join("; ")}. ` : "") + takes,
  );
}

/** What `refuseUnknownOptions` hands back for `undefined`, `null` or `false`. */
const NO_OPTIONS = Object.freeze({});
