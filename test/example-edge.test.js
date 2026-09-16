// @ts-check
/**
 * THE EDGE EXAMPLE'S PROPERTIES, plan 6.5:2335-2344 — measured, one assertion per sentence.
 *
 * `examples/edge/worker.js` is an example, so the temptation is to test that it does not crash and
 * move on. The plan does not describe demo code; it describes PROPERTIES, and every one of them is
 * the kind that a plausible implementation gets wrong while still rendering the right page:
 *
 *   header -> match -> manifest SUBSET      a worker that loaded the whole manifest renders
 *                                           identically and costs the edge every catalog.
 *   redirect target discards the match      a target that peeked at `Accept-Language` renders
 *                                           identically for the visitor who arrived from a redirect
 *                                           and poisons a url-keyed cache for the next one.
 *   never key match-preserving HTML by       the two headers below select the SAME locale with the
 *   selected locale alone                    SAME match type and are owed DIFFERENT bytes.
 *   fail soft on a malformed header          `matchForLanguageRanges` throws by contract; a request
 *                                           handler that lets it is a 5xx on a header a browser
 *                                           can send.
 *   digest verified before parse             a worker that trusted the body renders the same page
 *                                           from tampered catalogs.
 *   abort cancels outstanding work           the load rejecting is NOT the same as the reads
 *                                           stopping; S16 found exactly that gap in `runPlan`.
 *
 * **THE FIXTURE PAIR IS `fr-CH` AND `fr-BE`, AND IT IS THE WHOLE FILE.** Against
 * `examples/catalogs/`, both select `fr` by `cldr-fallback` — so the selected locale is equal, the
 * match TYPE is equal, and the serialized SSR projection (which is exactly those two fields) is
 * BYTE-IDENTICAL for the two. The rendered pages are not, because the view names the range the
 * visitor sent. That is plan 6.4:2321's "even equal selected locale and equal match type are
 * insufficient in general" turned into a measurement, and it is what makes the cache-key assertions
 * below capable of failing.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { handleRequest } from "../examples/edge/worker.js";
import { publishCatalogs } from "../examples/server/publish.js";
import { recordingOracleRows } from "../tools/oracle-field-coverage.mjs";
import { createLocaleNegotiator, parseLanguageRanges } from "../src/negotiate/index.js";
import { fetchSet, localeConfigurationForManifest } from "../src/load/index.js";

const BASE = "https://cdn.example/v1/";
const MANIFEST_URL = `${BASE}manifest.json`;

const published = await publishCatalogs({
  catalogVersion: "2026.09.15", publicationBaseUrl: BASE,
});
const MANIFEST_BYTES = new TextEncoder().encode(JSON.stringify(published.manifest));

/**
 * A transport that records every call and serves the published assets as MULTI-CHUNK streams.
 *
 * The chunking is deliberate: a single-chunk body would let a reader that ignores `done` and takes
 * the first chunk pass every assertion here. Plan 6.5:2342 lists response streams among the
 * capabilities the edge example requires, and a one-chunk fixture does not exercise one.
 *
 * @param {Readonly<{ tamper?: string, delayMs?: number }>} [options]
 */
function recordingTransport(options = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {(AbortSignal | undefined)[]} */
  const signals = [];
  /** @param {RequestInfo | URL} input @param {RequestInit} [init] */
  const impl = async (input, init) => {
    const url = String(input);
    calls.push(url.startsWith(BASE) ? url.slice(BASE.length) : url);
    signals.push(init?.signal ?? undefined);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (init?.signal?.aborted) throw init.signal.reason;

    const name = url.slice(BASE.length);
    let bytes = name === "manifest.json" ? MANIFEST_BYTES : published.assets.get(name);
    if (bytes === undefined) return new Response(null, { status: 404 });
    if (options.tamper !== undefined && name.startsWith(options.tamper)) {
      // SAME LENGTH, still valid JSON, different bytes. A digest check is the only thing that can
      // see this: the parser is perfectly happy and the page renders.
      const text = new TextDecoder().decode(bytes).replace("Bookshop", "BookshoQ");
      bytes = new TextEncoder().encode(text);
    }
    const body = bytes;
    return new Response(new ReadableStream({
      start(controller) {
        const middle = Math.floor(body.length / 2);
        controller.enqueue(body.slice(0, middle));
        controller.enqueue(body.slice(middle));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, signals, fetch: /** @type {typeof fetch} */ (/** @type {unknown} */ (impl)) };
}

/**
 * @param {Readonly<{ path?: string, header?: string | null, strategy?: "redirect" | "preserve",
 *   transport?: ReturnType<typeof recordingTransport>, signal?: AbortSignal }>} request
 */
async function call(request) {
  const transport = request.transport ?? recordingTransport();
  const headers = request.header == null ? undefined : { "accept-language": request.header };
  const response = await handleRequest(
    new Request(`https://bookshop.example${request.path ?? "/"}`, { headers, signal: request.signal }),
    { MANIFEST_URL, LOCALE_STRATEGY: request.strategy, fetch: transport.fetch },
  );
  return { response, calls: transport.calls };
}

/** The match the worker would build for a header, computed independently of the worker. */
function matchFor(/** @type {string} */ header) {
  return createLocaleNegotiator(localeConfigurationForManifest(published.manifest))
    .matchForLanguageRanges(parseLanguageRanges(header));
}

describe("the edge example converts a header to a match and loads only that subset", () => {
  test("it fetches the manifest and exactly the selected locale's fetch plan", async () => {
    const { response, calls } = await call({ header: "fr-CA,fr;q=0.9" });
    assert.equal(response.status, 200);

    const planned = fetchSet(published.manifest, "fr-CA").map((entry) => entry.url.slice(BASE.length));
    assert.deepEqual(calls, ["manifest.json", ...planned]);
    // ANTI-VACUITY: the plan must be a PROPER subset, or "it loaded only the subset" is a claim
    // about a fixture with nothing left out.
    assert.ok(planned.length < Object.keys(published.manifest.files).length,
      "the fixture must have a catalog this request does not need");
  });

  test("an unmatched header loads the fallback's plan and nothing else", async () => {
    const { calls } = await call({ header: "de" });
    assert.deepEqual(calls, ["manifest.json", ...fetchSet(published.manifest, "en")
      .map((entry) => entry.url.slice(BASE.length))]);
  });
});

describe("the redirect arm", () => {
  test("redirects to a locale-keyed url and varies on the header it read", async () => {
    const { response, calls } = await call({ header: "fr-CH", strategy: "redirect" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/fr/");
    assert.equal(response.headers.get("vary"), "Accept-Language");
    // It negotiated from the manifest alone. A redirect that loaded catalogs it is about to throw
    // away is the cost this arm exists to avoid.
    assert.deepEqual(calls, ["manifest.json"]);
  });

  test("the TARGET discards the match: identical bytes for different headers, and no Vary", async () => {
    const first = await call({ path: "/fr/", header: "de" });
    const second = await call({ path: "/fr/", header: "es,fr;q=0.2" });
    assert.equal(await first.response.text(), await second.response.text());
    assert.equal(first.response.headers.get("vary"), null,
      "a url-keyed response must not vary, or the url is not a complete cache key");
    assert.equal(first.response.headers.get("x-lokalized-cache-key"),
      second.response.headers.get("x-lokalized-cache-key"));
  });

  test("an unknown path segment is not treated as a locale", async () => {
    const { response } = await call({ path: "/xx-YY/", header: "fr-CH" });
    // Falls through to negotiation rather than trying to load a catalog that does not exist.
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("vary"), "Accept-Language");
  });
});

describe("match-preserving responses are never keyed by selected locale alone", () => {
  test("two headers with an identical narrow context are owed different bytes", async () => {
    const swiss = matchFor("fr-CH");
    const belgian = matchFor("fr-BE");

    // THE PRECONDITION, ASSERTED FIRST. Without it the rest of this test proves nothing: two
    // requests that differ in selected locale would separate under ANY key policy, including the
    // wrong one.
    assert.equal(swiss.locale, belgian.locale, "the fixture must select one locale for both");
    assert.equal(swiss.matchType, belgian.matchType, "and reach it by the same match type");
    assert.deepEqual(
      { locale: swiss.locale, matchType: swiss.matchType },
      { locale: belgian.locale, matchType: belgian.matchType },
      "the serialized SSR projection is exactly these two fields, so it cannot separate them either");

    const first = await call({ header: "fr-CH" });
    const second = await call({ header: "fr-BE" });
    const [firstBody, secondBody] = [await first.response.text(), await second.response.text()];

    assert.notEqual(firstBody, secondBody,
      "the view reads the requested ranges, so the narrow-context invariant of plan 6.4 is FALSE here");
    assert.notEqual(
      first.response.headers.get("x-lokalized-cache-key"),
      second.response.headers.get("x-lokalized-cache-key"),
      "and the cache key must therefore separate them");
    assert.equal(first.response.headers.get("vary"), "Accept-Language");
  });

  test("the key covers every field the match carries", async () => {
    // The instrument S32 built for the differentials, one layer over: hand the match through a
    // recording proxy and let EXECUTION say which fields the key derivation read. A field added to
    // `LocaleMatch` later and not folded into the key re-opens the collision silently, which is
    // exactly how the three dropped-column defects in that tool's header happened.
    const { matchPreservingCacheKey } = await import("../examples/app/cache-policy.js");
    const recorder = recordingOracleRows([/** @type {any} */ (matchFor("fr-CH"))]);
    await matchPreservingCacheKey({
      match: /** @type {any} */ (recorder.rows[0]),
      catalogFingerprint: published.manifest.catalogFingerprint,
      view: { cartCount: 3, readerName: "Ada", readerGender: "GENDER_FEMININE" },
    });
    const unread = [...recorder.emitted].filter((field) => !recorder.reads.has(field)).sort();
    assert.deepEqual(unread, [],
      `the match carries ${unread.join(", ")} and the cache key never reads it`);
    assert.ok(recorder.reads.size > 0, "the recorder observed nothing; it was not threaded through");
  });

  test("the match is genuinely preserved, and `isFallback` is where that is observable", async () => {
    // **THIS TEST EXISTS BECAUSE AN ABLATION DID NOT FIRE.** Rendering with `forLocale(selected)`
    // instead of `forLocaleMatch(match)` — i.e. throwing away the whole-list match while keeping the
    // locale it chose — left every other assertion in these files green, because the worker already
    // uses the SELECTED locale as its lookup, so the two produce identical translations. What they
    // do not produce identically is the diagnostic: plan 6.4:2320 says the match type "remains
    // observable in the stamp and `isFallback`", and that is the only channel that separates them.
    const swiss = await call({ header: "fr-CH" });          // cldr-fallback to fr
    const french = await call({ header: "fr" });            // exact fr
    const target = await call({ path: "/fr/", header: "fr-CH" }); // direct mode: match discarded

    const fallbackFlag = (/** @type {string} */ html) =>
      /data-fallback="(true|false)"/.exec(html)?.[1];
    const [swissHtml, frenchHtml, targetHtml] =
      [await swiss.response.text(), await french.response.text(), await target.response.text()];

    assert.equal(fallbackFlag(swissHtml), "true",
      "a preserved cldr-fallback match must still report that negotiation fell back");
    assert.equal(fallbackFlag(frenchHtml), "false");
    assert.equal(fallbackFlag(targetHtml), "false",
      "direct mode discarded the match, so there is no negotiation fallback to report");

    // And the two `/` responses are otherwise the same page in the same language, which is what
    // makes the flag the discriminator rather than a side effect of rendering something else.
    const stripped = (/** @type {string} */ html) =>
      html.replace(/<p class="notice">[^<]*<\/p>/, "").replace(/data-fallback="(true|false)"/, "");
    assert.equal(stripped(swissHtml), stripped(frenchHtml));
  });

  test("the key changes when the catalogs change", async () => {
    const { matchPreservingCacheKey } = await import("../examples/app/cache-policy.js");
    const inputs = {
      match: matchFor("fr-CH"),
      catalogFingerprint: published.manifest.catalogFingerprint,
      view: { cartCount: 3, readerName: "Ada", readerGender: "GENDER_FEMININE" },
    };
    assert.notEqual(await matchPreservingCacheKey(inputs),
      await matchPreservingCacheKey({ ...inputs, catalogFingerprint: "0".repeat(64) }));
  });

  test("the key changes when a match-dependent view input changes", async () => {
    const { matchPreservingCacheKey } = await import("../examples/app/cache-policy.js");
    const inputs = {
      match: matchFor("fr-CH"),
      catalogFingerprint: published.manifest.catalogFingerprint,
      view: { cartCount: 3, readerName: "Ada", readerGender: "GENDER_FEMININE" },
    };
    assert.notEqual(await matchPreservingCacheKey(inputs),
      await matchPreservingCacheKey({ ...inputs, view: { ...inputs.view, cartCount: 1 } }));
  });
});

describe("a malformed or absent header is not a server error", () => {
  for (const header of ["fr;q=2", "not a header!", "", "*;q=0.0.1"]) {
    test(`Accept-Language: ${JSON.stringify(header)} renders the fallback`, async () => {
      // The strict door throws for each of these; that is its contract, and the worker's guard is
      // what keeps a request handler from turning it into a 5xx.
      assert.throws(() => matchFor(header || "\t"), RangeError);
      const { response } = await call({ header });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /The Lokalized Bookshop/);
      // IT STILL VARIES. These bytes are served at the NEGOTIATING url, where a usable header would
      // have produced something else — so a cache that keyed them by url alone would serve the
      // fallback page to everyone. The first version of the worker omitted this.
      assert.equal(response.headers.get("vary"), "Accept-Language");
    });
  }

  test("an absent header renders the fallback and varies", async () => {
    const { response } = await call({ header: null });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("vary"), "Accept-Language");
  });
});

describe("the five capabilities plan 6.5:2342 requires are exercised, not asserted", () => {
  test("WebCrypto: a same-length, still-parseable body with a wrong digest is refused", async () => {
    const transport = recordingTransport({ tamper: "en." });
    await assert.rejects(call({ header: "de", transport }), (error) => {
      // The failure is at the DIGEST stage specifically. A loader that parsed first would reach
      // `parse` on a body this fixture deliberately keeps valid, which is the distinction S16's
      // clause-26 probe had to be rebuilt to make.
      const failures = /** @type {any} */ (error).failures;
      assert.ok(Array.isArray(failures) && failures.length > 0, "expected load failures");
      assert.equal(failures[0].stage, "digest");
      return true;
    });
  });

  test("AbortController: the request's signal reaches every read the worker starts", async () => {
    // **WHAT THIS PROVES, AND WHAT IT DOES NOT.** The example's job is to THREAD a signal — the
    // request's own, joined with its deadline — into the manifest read and the catalog load. That a
    // signal, once aborted, cancels `runPlan`'s outstanding queue is the LIBRARY's property and is
    // gated by `test/fetch-concurrency.test.js`; it cannot be re-proven here, because this manifest
    // plans at most three files against a concurrency cap of eight, so there is never a queue left
    // to cancel. Writing an "outstanding work stopped" assertion over this fixture would pass
    // whether or not the worker threaded anything, which is the `zh-123` shape this project keeps
    // finding inside the probe written to check the thing.
    const controller = new AbortController();
    const transport = recordingTransport({ delayMs: 5 });
    const pending = call({ header: "fr-CA,fr;q=0.9", transport, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 2));
    controller.abort();
    await assert.rejects(pending);

    assert.ok(transport.signals.length > 0, "no read was started");
    for (const signal of transport.signals) {
      assert.ok(signal instanceof AbortSignal, "a read was started with no signal at all");
      assert.ok(signal.aborted, "a read's signal did not observe the request's abort");
    }
  });

  test("AbortController: the deadline signal is threaded even when nobody aborts", async () => {
    // The control for the test above: without it, a worker that passed `undefined` on the happy path
    // and only built a signal when aborting would be indistinguishable.
    const transport = recordingTransport();
    await call({ header: "es", transport });
    assert.ok(transport.signals.length > 0);
    for (const signal of transport.signals) assert.ok(signal instanceof AbortSignal);
    for (const signal of transport.signals) assert.equal(signal.aborted, false);
  });

  test("streams and TextDecoder: multi-chunk bodies are read whole", async () => {
    // Every body this fixture serves arrives in two chunks, so a reader that stopped at the first
    // would produce a truncated catalog — which the digest would then refuse. Reaching a rendered
    // page at all is the measurement.
    const { response } = await call({ header: "es" });
    assert.match(await response.text(), /La libreria Lokalized/);
  });
});

after(() => {
  // Nothing to close: this file drives the worker over an injected transport on purpose, so that
  // call counts and abort timing are observable. `test/example-server.test.js` runs the same worker
  // against a real socket, which is where the capabilities are exercised for real.
});
