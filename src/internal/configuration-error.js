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
 * **EVERY PUBLIC DOOR IGNORED AN UNKNOWN OPTION IN SILENCE — twelve of twelve, measured.** It was
 * found four times one door at a time, each as a live defect in something else:
 * `createStrings({ limits })` running under the defaults, `loadStrings(…, { transport })` ignoring an
 * injected transport and going to THE REAL NETWORK, `createStringsManifestFromDirectory({ baseUrl })`
 * publishing a manifest the Fetch door then refuses, and `resolveLimits` reading seven named members
 * where Java's `LoadDiff.optionsFrom` throws. `test/option-surface.test.js` measured it as one
 * property rather than four anecdotes and pinned it; the maintainer then decided to refuse.
 *
 * **THE NEAR MISS IS WHY THIS TAKES A TABLE AND NOT JUST A LIST.** The two sharpest cases are one
 * concept under two names — `createStrings` spells the load-time limits `loadingLimits` and
 * `parseStrings` spells them `limits` — and the two that cost real time did not fail at the call at
 * all. A refusal naming only the offending key turns a silent trap into a loud one; a refusal that
 * names the spelling the caller wanted turns it into a signpost. The table is DECLARED rather than
 * fuzzy-matched, and `test/option-surface.test.js` requires every entry to be a real near miss:
 * a name this door does not accept, which some sibling door does.
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
 * @param {string} door the public name a caller typed, which is what the message must say
 * @param {unknown} options
 * @param {readonly string[]} accepted every member this door reads, including via a helper it calls
 * @param {Readonly<Record<string, string>>} [nearMisses] wrong spelling -> the one that works here
 * @returns {void}
 */
export function refuseUnknownOptions(door, options, accepted, nearMisses = {}) {
  // Nullish is "no options", not "an empty options object": `loadStringsFromDirectory(dir)` has no
  // `options = {}` default, and `Object.keys(undefined)` throws a TypeError naming nothing useful
  // where the door today answers a ConfigurationError that names what it needs. A non-object is left
  // to the door's own validation for the same reason.
  if (options === null || typeof options !== "object") return;

  const unknown = Object.keys(options).filter((name) => !accepted.includes(name));
  if (unknown.length === 0) return;

  const hints = unknown.filter((name) => name in nearMisses)
    .map((name) => `\`${name}\` is not the option name here; \`${nearMisses[name]}\` is`);
  throw configurationError(
    `${door} does not take the option(s) [${unknown.join(", ")}]. ` +
    (hints.length > 0 ? `${hints.join("; ")}. ` : "") +
    `It takes [${[...accepted].sort().join(", ")}]`,
  );
}
