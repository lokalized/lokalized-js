// @ts-check
/**
 * THE CACHE-KEY HALF OF PLAN 6.4, WHICH IS THE PART OF THESE EXAMPLES MOST LIKELY TO BE GOT WRONG.
 *
 * Plan 6.4:2302-2311 lists five legal ways to cache a document selected from `Accept-Language`, and
 * the two arms these examples take are the first and the second:
 *
 *   - **direct-locale mode** — a locale-keyed URL whose handler re-renders for that URL tag,
 *     "intentionally discarding the original whole-list match diagnostics". Its key is the URL. It
 *     needs no `Vary` at all, which is the entire reason a deployment reaches for the redirect.
 *   - **match-preserving mode** — "an explicitly normalized cache key that includes the selecting
 *     input or an application-owned opaque fingerprint of the complete supplied match and every
 *     match-dependent rendering input", with the corresponding `Vary` or a private-cache policy.
 *
 * **AND THE SENTENCE THIS FILE EXISTS TO OBEY IS A PROHIBITION:** plan 6.5:2341 — the edge example
 * "never keys match-preserving HTML by selected locale alone". Plan 6.4:2321-2322 says why, in terms
 * that are measurable rather than cautionary: "Even equal selected locale and equal match type are
 * insufficient in general: requested ranges, weights, and considered order are observable through
 * results/failures and may affect application callbacks."
 *
 * **MEASURED HERE, NOT QUOTED.** Against `examples/catalogs/`, `Accept-Language: fr-CH` and
 * `Accept-Language: fr-BE` both select `fr` by the same `cldr-fallback` match type — so a key built
 * from the selected locale, or even from the whole serialized SSR stamp, is IDENTICAL for the two.
 * The bytes are not: `Locale.Notice` renders the range the visitor sent. One visitor would be served
 * the other's page. `test/example-edge.test.js` asserts exactly that pair, and its ablation is the
 * one-line "key by `match.locale`" a reasonable author writes.
 *
 * **THE THIRD OPTION IN 6.4's LIST — the narrow serialized SSR context — IS UNAVAILABLE TO THIS APP,
 * and that is a conclusion rather than a preference.** It is admissible "only when a reviewed
 * application invariant proves omitted ranges, weights, considered locales, and callbacks cannot
 * affect rendered HTML". This view reads the ranges, so the invariant is false here and the test
 * demonstrates its falsity by rendering both pages and comparing them. An application whose view
 * genuinely ignores the request may take that option; this one may not.
 */

/**
 * @typedef {import("lokalized/core").LocaleMatch} LocaleMatch
 */

/** The `Vary` a match-preserving response must carry when it is shared-cacheable. */
export const MATCH_PRESERVING_VARY = "Accept-Language";

/**
 * Everything about the rendered page that is NOT the locale decision.
 *
 * The plan's phrase is "every match-dependent rendering input", and an app cannot tell which of its
 * own inputs are match-dependent without reviewing them — so this key covers the view model whole.
 * Under-covering here is the same defect as under-covering the match, one layer out.
 *
 * @param {Readonly<{ cartCount: number, readerName: string, readerGender: unknown }>} view
 */
function viewModelProjection(view) {
  return [view.cartCount, view.readerName, String(view.readerGender)];
}

/**
 * EVERY OBSERVABLE FIELD OF THE SUPPLIED MATCH, enumerated rather than serialized wholesale.
 *
 * `JSON.stringify(match)` would be shorter and would quietly depend on the library's own key order.
 * Naming the fields makes the coverage question answerable, and `test/example-edge.test.js` answers
 * it by EXECUTION: the match is handed to this function through a recording proxy
 * (`tools/oracle-field-coverage.mjs`, the instrument S32 built for the differentials), and a field
 * the match carries that this function never reads fails the test. A field added to `LocaleMatch`
 * later and not folded in here would otherwise re-open the collision silently, which is precisely
 * how the three dropped-column defects in `tools/oracle-field-coverage.mjs`'s header happened.
 *
 * The proxy observes TOP-LEVEL reads, so `languageRange` counts as read the moment it is touched;
 * the nested `range`/`weight` are covered by authoring, not by the gate. Said here rather than left
 * to be assumed.
 *
 * @param {LocaleMatch} match
 * @returns {unknown[]}
 */
function completeMatchProjection(match) {
  return [
    match.matchType,
    match.locale,
    match.isMatch,
    match.fallbackLocale,
    match.effectiveWeight,
    // `LocaleMatch.languageRange` is declared `string | WeightedLanguageRange | null` — a range door
    // can hand back the raw range it was given. Collapsing the two shapes into one projection keeps
    // `"fr-ch"` and `{ range: "fr-ch", weight: 1 }` from hashing differently for no reason.
    match.languageRange === null ? null
      : typeof match.languageRange === "string" ? [match.languageRange, null]
      : [match.languageRange.range, match.languageRange.weight],
    match.requestedLanguageRanges.map((range) => [range.range, range.weight]),
    match.consideredLocales,
  ];
}

/**
 * @param {string} text
 * @returns {Promise<string>} lowercase hex SHA-256
 */
async function sha256Hex(text) {
  // WebCrypto, which plan 6.5:2342 lists among the five capabilities the edge example requires. It is
  // also what makes this function async, which is why the worker awaits its own cache key.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The key for a MATCH-PRESERVING response. Opaque by construction: it is a digest, so nothing
 * downstream can be tempted to parse a locale back out of it.
 *
 * `catalogFingerprint` is in the key because a catalog change must not be served from the old entry —
 * the identity `lokalized/load` computes is exactly the value that changes when any translation does.
 *
 * @param {Readonly<{
 *   match: LocaleMatch,
 *   catalogFingerprint: string,
 *   view: Readonly<{ cartCount: number, readerName: string, readerGender: unknown }>,
 * }>} inputs
 * @returns {Promise<string>}
 */
export async function matchPreservingCacheKey(inputs) {
  return `lokalized-match:${await sha256Hex(JSON.stringify([
    1, inputs.catalogFingerprint,
    completeMatchProjection(inputs.match),
    viewModelProjection(inputs.view),
  ]))}`;
}

/**
 * The key for a DIRECT-LOCALE response — the redirect target.
 *
 * It takes no match because there is none: the target re-renders from the URL's own tag and the
 * whole-list diagnostics are gone by then. That is what buys the URL-only key and the absent `Vary`,
 * and it is the trade the redirect arm exists to make.
 *
 * @param {Readonly<{
 *   urlLocale: string,
 *   catalogFingerprint: string,
 *   view: Readonly<{ cartCount: number, readerName: string, readerGender: unknown }>,
 * }>} inputs
 * @returns {Promise<string>}
 */
export async function directLocaleCacheKey(inputs) {
  return `lokalized-direct:${await sha256Hex(JSON.stringify([
    1, inputs.catalogFingerprint, inputs.urlLocale, viewModelProjection(inputs.view),
  ]))}`;
}
