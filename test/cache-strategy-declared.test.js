import assert from "node:assert/strict";
import { test } from "node:test";

import { handleRequest } from "../examples/edge/worker.js";
import { publishCatalogs } from "../examples/server/publish.js";

/**
 * M8 CLAUSE 51 — every cacheable document selected from `Accept-Language` DECLARES one of plan
 * 6.4's strategies, and `Vary` is one of them rather than something forbidden.
 *
 * **This clause was DEFERRED to M-D, and M-D is now.** The deferral said plan 6.4's cache-correctness
 * prose "is documentation for M-D, not code, and nothing here implements or gates it". Since then M9
 * S1 built the edge example that implements two of the five strategies, S18 gated the key separation
 * (clause 50), and the README grew a caching section. What was still missing is the rule that makes a
 * NEW route safe rather than each existing one correct.
 *
 * **THE RULE IS DERIVED FROM THE RESPONSE, not from a list of routes**, which is what lets it catch
 * something nobody thought to assert:
 *
 *   1. every shared-cacheable response declares a strategy — `Vary: Accept-Language`, or a key that
 *      the URL alone determines. Never neither.
 *   2. a response whose bytes, status or `Location` CHANGE with the header must carry
 *      `Vary: Accept-Language`. Sensitivity is measured by rendering each route twice, not declared.
 *
 * **RULE 2 IS A DEFECT THIS EXAMPLE ACTUALLY HAD**, and `examples/edge/worker.js`'s own header records
 * it: a malformed header used to be answered by rendering the fallback in direct mode, served at `/`
 * — the negotiating url, where a usable header produces different bytes — with no `Vary`, so a shared
 * cache would have served the fallback page to every later visitor. Each route was individually
 * correct after the fix; nothing stopped the next one from repeating it.
 *
 * **THERE IS NO RULE SAYING `Vary` MUST BE ABSENT ANYWHERE**, deliberately. The clause's second half
 * is that no unconditional prohibition exists, and an assertion that a locale-keyed response must not
 * vary would be exactly that prohibition. What the URL-keyed arm buys is pinned by
 * `test/example-edge.test.js`'s "the TARGET discards the match: identical bytes for different headers,
 * and no Vary", which is a statement about the response being URL-determined rather than about `Vary`.
 */

const BASE = "https://cdn.example/v1/";
const published = await publishCatalogs({ catalogVersion: "v1", publicationBaseUrl: BASE });
const MANIFEST_BYTES = new TextEncoder().encode(JSON.stringify(published.manifest));

/** @type {typeof fetch} */
const transport = /** @type {any} */ (async (/** @type {RequestInfo | URL} */ input) => {
  const name = String(input).slice(BASE.length);
  const bytes = name === "manifest.json" ? MANIFEST_BYTES : published.assets.get(name);
  return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes);
});

/** Every route the worker answers, and both strategies it can be deployed under. */
const PATHS = ["/", "/fr/", "/fr-CA/", "/en/", "/es/", "/nope/"];
const STRATEGIES = /** @type {const} */ (["redirect", "preserve"]);
/** Two headers that select different locales, so a header-sensitive route cannot hide. */
const HEADERS = ["fr-CH,fr;q=0.9", "de"];

/** @param {string} path @param {"redirect" | "preserve"} strategy @param {string} header */
async function respond(path, strategy, header) {
  const response = await handleRequest(
    new Request(`https://shop.example${path}`, { headers: { "accept-language": header } }),
    { MANIFEST_URL: `${BASE}manifest.json`, LOCALE_STRATEGY: strategy, fetch: transport },
  );
  return {
    status: response.status,
    vary: response.headers.get("vary"),
    cacheControl: response.headers.get("cache-control"),
    key: response.headers.get("x-lokalized-cache-key"),
    location: response.headers.get("location"),
    body: await response.text(),
  };
}

/** Each route under each strategy, with header-sensitivity MEASURED rather than declared. */
const observations = [];
for (const strategy of STRATEGIES)
  for (const path of PATHS) {
    const [first, second] = await Promise.all(HEADERS.map((header) => respond(path, strategy, header)));
    observations.push({
      route: `${strategy} ${path}`,
      response: first,
      headerSensitive:
        first.body !== second.body || first.status !== second.status || first.location !== second.location,
    });
  }

const varies = (/** @type {{ vary: string | null }} */ response) =>
  (response.vary ?? "").toLowerCase().split(",").map((part) => part.trim()).includes("accept-language");
const sharedCacheable = (/** @type {{ cacheControl: string | null }} */ response) =>
  (response.cacheControl ?? "").includes("public");

test("both classes of route exist, or the rules below are satisfied vacuously", () => {
  const sensitive = observations.filter((o) => o.headerSensitive);
  const insensitive = observations.filter((o) => !o.headerSensitive);

  assert.ok(observations.length >= 12, `only ${observations.length} route observations`);
  assert.ok(sensitive.length > 0, "no route reads the header, so rule 2 asserts nothing");
  assert.ok(insensitive.length > 0, "every route reads the header, so rule 1's key branch is untested");
  assert.ok(observations.every((o) => sharedCacheable(o.response)),
    "a route stopped being shared-cacheable; rule 1 no longer applies to it and that needs saying");
});

test("every shared-cacheable response declares a cache strategy", () => {
  const undeclared = observations
    .filter((o) => sharedCacheable(o.response) && !varies(o.response) && o.response.key === null)
    .map((o) => o.route);

  assert.deepEqual(undeclared, [],
    "a public response carries neither Vary: Accept-Language nor a cache key, so a shared cache has " +
    "no way to tell two visitors' pages apart");
});

test("a response that changes with the header varies on it", () => {
  // The defect this example actually had, generalized: correct per route is not the same property as
  // correct for the next route somebody adds.
  const unvaried = observations.filter((o) => o.headerSensitive && !varies(o.response)).map((o) => o.route);

  assert.deepEqual(unvaried, [],
    "a response whose bytes depend on Accept-Language does not vary on it; a shared cache would " +
    "serve one visitor's page to the next");
});

test("`Vary: Accept-Language` is one of the strategies in use, not a prohibited one", () => {
  // The clause's second half. Both deployments of this one application reach for it at the
  // negotiating url, which is what makes "there is no unconditional prohibition" a fact about the
  // shipped code rather than a reading of the plan.
  const varying = observations.filter((o) => varies(o.response)).map((o) => o.route);

  assert.ok(varying.includes("redirect /"), "the redirect arm's negotiating url must vary");
  assert.ok(varying.includes("preserve /"), "the match-preserving arm's document must vary");
});
