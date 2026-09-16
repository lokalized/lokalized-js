// @ts-check
/**
 * THE SERVER EXAMPLE — plan 6.5's SSR row, executed rather than illustrated.
 *
 * "Server negotiates once and stamps the result. Preload exact digest-bound immutable files; apply one
 * cache strategy from 6.4."
 *
 * A real `node:http` server. `npm run example:server` starts it; `test/example-server.test.js` drives
 * it over a loopback socket, and `test/example-edge.test.js` points the EDGE worker at the manifest
 * this same server publishes — so the two examples are not two descriptions of one idea but one
 * deployment with two doors onto it.
 *
 * THREE ROUTES, AND THEIR CACHE HEADERS ARE THE POINT:
 *
 *   `GET /`                        the negotiated document. `Vary: Accept-Language`, which is the
 *                                  fourth of plan 6.4's five legal strategies and the one an SSR
 *                                  deployment usually wants: the cardinality is bounded by the
 *                                  header space a CDN normalizes, and no application-owned key has
 *                                  to be plumbed through the cache.
 *   `GET /catalogs/manifest.json`  short-lived. It names digests, so it is the document that must
 *                                  change when the catalogs do.
 *   `GET /catalogs/<tag>.<8 hex>.json`
 *                                  `immutable`, for a year. The name contains the digest of the
 *                                  bytes, so the URL can never describe different bytes later. This
 *                                  is what plan 6.3:2177's preload example requires and what
 *                                  `examples/server/publish.js` exists to produce.
 *
 * **ONE INSTANCE, BUILT ONCE, SHARED BY EVERY REQUEST.** Plan 6.6:2354 — "`createStrings` compiles
 * expressions eagerly. Servers keep an immutable instance or bounded set of instances per catalog
 * version and atomically replace references on reload." Locale selection is per CALL, through
 * `forLocaleMatch`, never by rebuilding. `test/example-server.test.js` asserts the instance identity
 * is stable across requests in different locales, because "construct per request" is the shape this
 * sentence exists to rule out and it would pass every behavioural assertion.
 *
 * **THE PRELOAD LINKS ARE COMPUTED, NOT GUESSED.** `fetchSet(manifest, lookupLocale)` is the loader's
 * own planner: the files a lookup subset would actually fetch, in first-use order. The server emits
 * one `<link rel="preload">` per entry, so the hrefs are the client's fetch plan BY CONSTRUCTION
 * rather than by a second implementation that agrees today. Plan 6.3:2179-2183 requires the later
 * fetch to use the same url, destination, CORS mode and credentials mode for the preload to be
 * reused at all, and the test compares the emitted hrefs to the client's recorded `requestedFiles`.
 */
import { createServer } from "node:http";

import { createStrings, forLocale, forLocaleMatch } from "lokalized/core";
import { fetchSet } from "lokalized/load";
import { loadEntireManifestFromFiles } from "lokalized/node";
import { createLocaleNegotiator, parseLanguageRanges } from "lokalized/negotiate";
import { createSsrStamp } from "lokalized/ssr";
import { GENDER_FEMININE } from "lokalized";

import { localCatalogManifest, publishCatalogs } from "./publish.js";
import { MATCH_PRESERVING_VARY } from "../app/cache-policy.js";
import { renderPage } from "../app/render.js";

/** @typedef {import("lokalized/core").LocaleMatch} LocaleMatch */
/** @typedef {import("lokalized/load").StringsManifestV1} StringsManifestV1 */

/** The same view model the edge example renders, so the two are comparable. */
const VIEW_MODEL = Object.freeze({
  cartCount: 3, readerName: "Ada", readerGender: GENDER_FEMININE,
});

const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Start the bookshop.
 *
 * @param {Readonly<{ catalogVersion?: string, port?: number, host?: string }>} [options]
 * @returns {Promise<Readonly<{
 *   origin: string,
 *   manifestUrl: string,
 *   manifest: StringsManifestV1,
 *   strings: ReturnType<typeof createStrings>,
 *   close: () => Promise<void>,
 * }>>}
 */
export async function startBookshop(options = {}) {
  const catalogVersion = options.catalogVersion ?? "2026.09.15";

  // THE RENDERER'S OWN CATALOGS COME OFF THE DISK, through the `file:` manifest. Nothing here fetches
  // its own translations over the network it is serving.
  const local = await localCatalogManifest({ catalogVersion });
  const loaded = await loadEntireManifestFromFiles(local);
  const strings = createStrings({ loaded, locale: loaded.fallbackLocale });
  const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());

  const server = createServer();
  await new Promise((resolve) => server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  const origin = `http://${address.address}:${address.port}`;

  // THE PUBLISHED MANIFEST IS BUILT AFTER `listen`, because its file URLs are absolute and a
  // deployment cannot name its own origin before it has one.
  const published = await publishCatalogs({
    catalogVersion, publicationBaseUrl: `${origin}/catalogs/`,
  });

  server.on("request", (request, response) => {
    void respond(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
      response.end("internal error");
    });
  });

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  async function respond(request, response) {
    const url = new URL(request.url ?? "/", origin);

    if (url.pathname === "/catalogs/manifest.json") {
      const body = JSON.stringify(published.manifest);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        // NOT immutable: this document names digests, so it is exactly the one that changes.
        "cache-control": "public, max-age=60",
        "content-length": String(Buffer.byteLength(body)),
      });
      response.end(body);
      return;
    }

    if (url.pathname.startsWith("/catalogs/")) {
      const asset = published.assets.get(url.pathname.slice("/catalogs/".length));
      if (asset === undefined) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("no such catalog");
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": IMMUTABLE,
        "content-length": String(asset.byteLength),
      });
      response.end(Buffer.from(asset));
      return;
    }

    if (url.pathname !== "/") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }

    const header = request.headers["accept-language"];
    const body = renderDocument(typeof header === "string" ? header : null);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // Plan 6.4's `Vary: Accept-Language` strategy, chosen here and named as a choice. The edge
      // example takes the explicit-key strategy instead, so the two arms both ship.
      vary: MATCH_PRESERVING_VARY,
      "cache-control": "public, max-age=60",
      "content-length": String(Buffer.byteLength(body)),
    });
    response.end(body);
  }

  /**
   * Negotiate ONCE, render, stamp.
   *
   * @param {string | null} header
   * @returns {string}
   */
  function renderDocument(header) {
    const match = matchOrNull(negotiator, header);
    const lookupLocale = match === null ? strings.getLocaleConfiguration().fallbackLocale
      : match.isMatch && match.locale !== null ? match.locale : match.fallbackLocale;

    // The stamp's context and the call options describe the SAME decision and must agree: a
    // supplied match stamps `{kind: "locale-match"}`, and the fail-soft path has no match to
    // preserve, so it stamps the direct context it actually rendered.
    const callOptions = match === null ? forLocale(lookupLocale) : forLocaleMatch(match);
    const stamp = createSsrStamp(strings, match === null
      ? { kind: "locale", locale: lookupLocale }
      : { kind: "locale-match", localeMatch: match });

    const document = renderPage(strings, {
      callOptions,
      requestedRanges: match === null ? [] : match.requestedLanguageRanges.map((r) => r.range),
      servedLocale: lookupLocale,
      stamp,
      ...VIEW_MODEL,
    });
    return withPreloads(document, preloadLinks(published.manifest, stamp.lookupLocale));
  }

  return Object.freeze({
    origin,
    manifestUrl: `${origin}/catalogs/manifest.json`,
    manifest: published.manifest,
    strings,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined)))),
  });
}

/**
 * The strict negotiation door behind the fail-soft guard the edge worker also uses.
 *
 * @param {ReturnType<typeof createLocaleNegotiator>} negotiator
 * @param {string | null} header
 * @returns {LocaleMatch | null}
 */
function matchOrNull(negotiator, header) {
  if (header === null || header.trim() === "") return null;
  try {
    return negotiator.matchForLanguageRanges(parseLanguageRanges(header));
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * Plan 6.3:2177's preload element, one per file the client's lookup subset will fetch.
 *
 * `crossorigin` with no value is the ANONYMOUS mode, which is what the default loader uses: plan
 * 6.3:2181 is explicit that a `credentials: "include"` client would need `use-credentials` instead,
 * and a mismatch there means the preload is fetched and then not reused — strictly worse than not
 * preloading at all.
 *
 * @param {StringsManifestV1} manifest
 * @param {string} lookupLocale
 * @returns {string[]}
 */
function preloadLinks(manifest, lookupLocale) {
  return fetchSet(manifest, lookupLocale).map((entry) =>
    `  <link rel="preload" as="fetch" href="${entry.url}" type="application/json" crossorigin>`);
}

/**
 * @param {string} document
 * @param {readonly string[]} links
 * @returns {string}
 */
function withPreloads(document, links) {
  return document.replace("</head>", `${links.join("\n")}\n</head>`);
}

// `node examples/server/server.js` starts it on a real port and prints where.
if (import.meta.url === `file://${process.argv[1]}`) {
  const bookshop = await startBookshop({ port: Number(process.env.PORT ?? 8787) });
  process.stdout.write(`bookshop listening on ${bookshop.origin}\n`);
  process.stdout.write(`manifest: ${bookshop.manifestUrl}\n`);
}
