// @ts-check
/**
 * THE EDGE EXAMPLE — plan 6.5:2335-2344, executed rather than illustrated.
 *
 * A worker-shaped `fetch` handler that converts an `Accept-Language` header into a match, loads only
 * that locale's manifest subset, and then takes ONE of the plan's two arms:
 *
 *   **redirect** — answer `302` to a locale-keyed URL whose handler re-renders in direct-locale mode,
 *   "intentionally discarding the original whole-list match diagnostics". The redirect itself varies
 *   by `Accept-Language`; its target does not vary at all and is cacheable by URL alone. This is the
 *   arm that buys a shared cache a single entry per locale.
 *
 *   **preserve** — render with the whole-list match intact and key the response by an opaque
 *   fingerprint of the COMPLETE match plus every match-dependent rendering input, with the
 *   corresponding `Vary`. This arm keeps `isFallback`, the match type and the requested ranges
 *   observable to the page, and pays for it in cache cardinality.
 *
 * **WHAT THIS FILE MAY NOT CONTAIN.** Plan 6.5:2343 — "Node-only code is forbidden from the graph".
 * `tools/example-graphs.mjs` walks this module's transitive imports and fails on a `node:` specifier
 * or anything under `src/node/`, and it proves it discriminates by walking the server example, whose
 * graph legitimately contains both. The capabilities this worker DOES require are the five the plan
 * names — Fetch, response streams, `AbortController`, `TextDecoder` and WebCrypto — and each is
 * exercised on a real path rather than asserted: the manifest and catalogs arrive by `fetch`, the
 * loader reads bodies as streams and verifies their SHA-256 with WebCrypto before parsing, the
 * request's signal is threaded into the load, and `TextDecoder` decodes the verified bytes.
 *
 * **THE FAIL-SOFT SEAM IS DELIBERATE AND IS THE ONE PLACE THE TWO NEGOTIATION DOORS DIFFER.**
 * `parseLanguageRanges` and `matchForLanguageRanges` are STRICT — a header with `q=2`, or one that
 * expands past 32 members, throws `RangeError`, and a request handler must not turn a header a
 * browser can legitimately send into a 5xx. This example therefore uses neither directly: plan
 * 3.4:908's `forAcceptLanguage` IS the fail-soft door, and it hands back core's per-call options
 * with an unmatched diagnostic rather than a fabricated match. An earlier version of this file
 * hand-rolled that guard — which is what an application without the helper has to do, and is the
 * reason the helper exists. `test/example-edge.test.js` sends the headers that take that path and
 * `test/negotiate-options.test.js` pins the contract itself.
 */
// TWO ENTRY POINTS, AND THE SPLIT IS NOT A STYLE CHOICE. The 61 tagged language-form constants are
// exported from the root only; `forLocale` and `forLocaleMatch` — the per-call locale helpers — are
// exported from `lokalized/core` only. Measured 2026-09-15 against the built export map: of the five
// symbols plan 3.1's `core` row NAMES that are runtime exports, these two are the only ones the root
// does not re-export (counting everything core exports, eighteen are absent from the root — the
// error classes and the build-identity constants among them, all outside 3.1's named list). Both
// modules resolve to the same files, so this costs the graph nothing, but an application that
// imports only `lokalized` cannot name the option helpers and must hand-write `{ locale }` /
// `{ localeMatch }` instead.
import { GENDER_FEMININE } from "lokalized";
import { createStrings, forLocale } from "lokalized/core";
import { loadStrings, localeConfigurationForManifest, parseStringsManifest } from "lokalized/load";
import { createLocaleNegotiator, forAcceptLanguage } from "lokalized/negotiate";

import {
  MATCH_PRESERVING_VARY, directLocaleCacheKey, matchPreservingCacheKey,
} from "../app/cache-policy.js";
import { renderPage } from "../app/render.js";

/**
 * @typedef {import("lokalized/core").LocaleMatch} LocaleMatch
 * @typedef {import("lokalized/load").StringsManifestV1} StringsManifestV1
 */

/**
 * The worker's bindings. A real deployment supplies `MANIFEST_URL` and `LOCALE_STRATEGY` from its
 * environment; `fetch` is injectable so the tests can drive the whole handler over a recording
 * transport instead of a network.
 *
 * @typedef {Readonly<{
 *   MANIFEST_URL: string,
 *   LOCALE_STRATEGY?: "redirect" | "preserve",
 *   fetch?: typeof fetch,
 * }>} Env
 */

/** The view model this example renders. Fixed here so the examples compare like for like. */
const VIEW_MODEL = Object.freeze({
  cartCount: 3, readerName: "Ada", readerGender: GENDER_FEMININE,
});

/** How long the worker gives the whole load before abandoning it. */
const LOAD_TIMEOUT_MS = 5_000;

export default { fetch: handleRequest };

/**
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, env) {
  const transport = env.fetch ?? fetch;
  // ONE signal for the whole request: the client going away and the worker's own deadline are the
  // same event as far as outstanding catalog reads are concerned. `runPlan` cancels its queue on
  // abort rather than merely rejecting (the defect S16 found), so this actually stops work.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(LOAD_TIMEOUT_MS)]);

  const manifest = await readManifest(env.MANIFEST_URL, transport, signal);
  const configuration = localeConfigurationForManifest(manifest);

  const urlLocale = localeFromPath(new URL(request.url), configuration.supportedLocales);
  if (urlLocale !== null) {
    return directLocaleResponse(manifest, urlLocale, transport, signal);
  }

  const header = request.headers.get("accept-language");
  const strategy = env.LOCALE_STRATEGY ?? "preserve";
  const negotiator = createLocaleNegotiator(configuration);

  if (strategy === "redirect") {
    // FAIL-SOFT BY CONTRACT: every unusable header answers the configured fallback here, so this arm
    // needs no guard of its own.
    const selected = negotiator.bestMatchForAcceptLanguage(header);
    return new Response(null, {
      status: 302,
      headers: {
        location: `/${encodeURIComponent(selected)}/`,
        // The REDIRECT varies by the header, because that is what chose the target. Its target does
        // not, which is the whole point of the arm.
        vary: MATCH_PRESERVING_VARY,
        "cache-control": "public, max-age=60",
      },
    });
  }

  // **ONE CALL, AND IT IS FAIL-SOFT BY CONTRACT** — plan 3.4:929-932. `matchForLanguageRanges` and
  // `parseLanguageRanges` are STRICT and throw on a header a browser can legitimately send
  // (`q=2`, a 33-range expansion, 4,097 code units), so a request handler that reaches for them
  // directly has to write its own guard, and an earlier version of this file did. `forAcceptLanguage`
  // IS that guard: unusable input carries an UNMATCHED diagnostic whose own `locale` is null, and
  // core consumes it by using the configured fallback as the lookup locale. Nothing is truncated and
  // nothing is fabricated — the page can still tell "you asked for a language we do not publish"
  // (one requested range, no match) from "we could not read your header at all" (no requested
  // ranges), which a handler that substituted the fallback tag would have thrown away.
  return matchPreservingResponse(manifest, forAcceptLanguage(negotiator, header), transport, signal);
}

/**
 * @param {string} url
 * @param {typeof fetch} transport
 * @param {AbortSignal} signal
 * @returns {Promise<StringsManifestV1>}
 */
async function readManifest(url, transport, signal) {
  const response = await transport(url, { signal });
  if (!response.ok) throw new Error(`manifest ${url} answered ${response.status}`);
  // `parseStringsManifest` re-validates everything the generator promised — including that every
  // declared tiebreaker names a locale the manifest actually publishes — so a corrupted or truncated
  // manifest is refused here rather than three steps later as a confusing construction failure.
  return parseStringsManifest(await response.text(), { source: url });
}

/**
 * `/fr-CA/` -> `"fr-CA"`, and only for a locale the manifest actually publishes.
 *
 * The comparison is against the manifest's OWN normalized tags rather than a pattern, so a path that
 * merely looks like a tag cannot conjure a load for a catalog that does not exist.
 *
 * @param {URL} url
 * @param {readonly string[]} supportedLocales
 * @returns {string | null}
 */
function localeFromPath(url, supportedLocales) {
  const first = url.pathname.split("/").filter((segment) => segment !== "")[0];
  if (first === undefined) return null;
  const decoded = decodeURIComponent(first);
  return supportedLocales.find((tag) => tag.toLowerCase() === decoded.toLowerCase()) ?? null;
}

/**
 * THE REDIRECT TARGET — direct-locale mode.
 *
 * It re-renders from the URL's tag and never reads `Accept-Language`, so two visitors with different
 * headers who arrive at the same URL get byte-identical bytes. That is what makes the URL a complete
 * cache key and why this response carries no `Vary: Accept-Language`.
 *
 * **IT IS REACHED ONLY FROM A LOCALE-KEYED URL, and an earlier version of this file proved why that
 * matters.** Back when a malformed header was answered by rendering the fallback in direct mode,
 * this same function served that response at `/` — the NEGOTIATING url, where a usable header
 * produces different bytes — and it carried no `Vary`, so a shared cache would have served the
 * fallback page to every later visitor. `forAcceptLanguage` removed that path rather than patching
 * it: an unusable header now carries an unmatched diagnostic through the match-preserving arm, which
 * varies. The lesson survives the code: a cache policy belongs to the URL a response is served at,
 * not to the rendering that produced it.
 *
 * @param {StringsManifestV1} manifest
 * @param {string} locale
 * @param {typeof fetch} transport
 * @param {AbortSignal} signal
 * @returns {Promise<Response>}
 */
async function directLocaleResponse(manifest, locale, transport, signal) {
  const loaded = await loadStrings(manifest, locale, { fetch: transport, signal });
  const strings = createStrings({ loaded, locale });
  const body = renderPage(strings, {
    callOptions: forLocale(locale),
    // DIRECT MODE HAS NO REQUESTED RANGES TO SHOW, and saying so in the view is the honest rendering
    // of "the whole-list diagnostics were discarded" rather than smuggling the header back in.
    requestedRanges: [],
    servedLocale: locale,
    ...VIEW_MODEL,
  });
  // NO `Vary`. The locale-keyed url is a COMPLETE cache key, which is the trade the redirect arm
  // exists to make, and it is only sound because nothing in this function reads the request.
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-lokalized-cache-key": await directLocaleCacheKey({
        urlLocale: locale, catalogFingerprint: manifest.catalogFingerprint, view: VIEW_MODEL,
      }),
    },
  });
}

/**
 * THE MATCH-PRESERVING RESPONSE.
 *
 * The subset loaded is the SELECTED locale's candidate chain — the match's own locale when it matched,
 * the configured fallback when it did not. The match itself is still built from the FULL manifest
 * configuration, which is the separation S9 landed: selection sees every locale the publisher
 * declared, resolution sees only the catalogs that arrived.
 *
 * @param {StringsManifestV1} manifest
 * @param {Readonly<{ localeMatch: LocaleMatch }>} callOptions what `forAcceptLanguage` negotiated
 * @param {typeof fetch} transport
 * @param {AbortSignal} signal
 * @returns {Promise<Response>}
 */
async function matchPreservingResponse(manifest, callOptions, transport, signal) {
  const match = callOptions.localeMatch;
  const lookupLocale = match.isMatch && match.locale !== null ? match.locale : match.fallbackLocale;
  const loaded = await loadStrings(manifest, lookupLocale, { fetch: transport, signal });
  const strings = createStrings({ loaded, locale: lookupLocale });
  const body = renderPage(strings, {
    callOptions,
    requestedRanges: match.requestedLanguageRanges.map((range) => range.range),
    servedLocale: lookupLocale,
    ...VIEW_MODEL,
  });
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The response is shared-cacheable ONLY together with both of these. Dropping either one is
      // the defect: `vary` alone lets a cache key by a header it has not normalized, and the key
      // alone lets an intermediary that ignores it serve one visitor's page to another.
      vary: MATCH_PRESERVING_VARY,
      "cache-control": "public, max-age=300",
      "x-lokalized-cache-key": await matchPreservingCacheKey({
        match, catalogFingerprint: manifest.catalogFingerprint, view: VIEW_MODEL,
      }),
    },
  });
}
