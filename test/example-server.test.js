// @ts-check
/**
 * THE SERVER EXAMPLE'S PROPERTIES — plan 6.5's SSR row and plan 6.3's preload contract, over a real
 * socket.
 *
 * `examples/server/server.js` is started on a loopback port and driven with `fetch`, so every
 * assertion below runs against real HTTP, real response streams and real WebCrypto rather than a
 * stub. The last test in this file points the EDGE worker at this server's published manifest, which
 * is the only place the two examples meet — and the meeting is the point: one deployment, two doors.
 *
 * **THE SEAM THIS FILE EXISTS FOR IS THE PRELOAD.** Plan 6.3:2177-2183 requires the preloaded url to
 * be the one the client later fetches, exactly, or the preload is fetched and then not reused — which
 * is strictly worse than not preloading. The server computes its links from `fetchSet`, the loader's
 * own planner, and the client computes its plan from `loadStrings`. Those are two halves that are
 * each green alone and have never been compared, which is the shape of the two defects S10 found
 * between the Fetch loader and the loaded branch. Here they are compared, url for url and in order.
 *
 * **AND THE TWO MANIFESTS ARE A SECOND SEAM.** The renderer loads over `file:` and the client over
 * `https:`; the SSR stamp crosses between them. It can only do that because `CatalogIdentityInputV1`
 * omits every url, which S6 tested from the inside and this tests from the outside.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { createStrings } from "../src/core/index.js";
import { loadStrings, parseStringsManifest } from "../src/load/index.js";
import { validateSsrStamp } from "../src/ssr/index.js";
import { localCatalogManifest, publishCatalogs } from "../examples/server/publish.js";
import { startBookshop } from "../examples/server/server.js";
import { handleRequest } from "../examples/edge/worker.js";

/** @type {Awaited<ReturnType<typeof startBookshop>>} */
let shop;

before(async () => { shop = await startBookshop({ catalogVersion: "2026.09.15" }); });
after(async () => { await shop.close(); });

/** @param {string} html */
function stampFrom(html) {
  const match = /<script type="application\/json" id="lokalized-ssr-stamp">([^<]*)<\/script>/.exec(html);
  assert.ok(match, "the rendered document carries no SSR stamp");
  const decoded = /** @type {string} */ (match[1])
    .replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return JSON.parse(decoded);
}

/** @param {string} html */
const preloadHrefs = (html) =>
  [...html.matchAll(/<link rel="preload" as="fetch" href="([^"]+)"/g)].map((m) => m[1]);

/** @param {string} header */
async function render(header) {
  const response = await fetch(`${shop.origin}/`, { headers: { "accept-language": header } });
  return { response, html: await response.text() };
}

describe("one deployment, two manifests, one catalog identity", () => {
  test("the file: manifest and the published https: manifest agree on the fingerprint", async () => {
    const local = await localCatalogManifest({ catalogVersion: "2026.09.15" });
    const published = await publishCatalogs({
      catalogVersion: "2026.09.15", publicationBaseUrl: "https://cdn.example/v1/",
    });
    assert.equal(local.catalogFingerprint, published.manifest.catalogFingerprint);
    assert.equal(shop.manifest.catalogFingerprint, local.catalogFingerprint);

    // ANTI-VACUITY, both halves. The urls really do differ — otherwise this asserts nothing about
    // what identity excludes — and a real translation change really does move the fingerprint.
    assert.notDeepEqual(
      Object.values(local.files).map((f) => f.url),
      Object.values(published.manifest.files).map((f) => f.url));
    assert.notEqual(local.catalogFingerprint,
      (await publishCatalogs({ catalogVersion: "OTHER", publicationBaseUrl: "https://cdn.example/v1/" }))
        .manifest.catalogFingerprint);
  });

  test("published catalog urls are digest-bound and served immutable", async () => {
    for (const [locale, entry] of Object.entries(shop.manifest.files)) {
      assert.ok(entry.url.endsWith(`/${locale}.${entry.sha256.slice(0, 8)}.json`),
        `${locale} is published at ${entry.url}, which does not name its own digest`);
      const response = await fetch(entry.url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    }
    // The manifest itself must NOT be immutable: it is the document that changes.
    const manifest = await fetch(shop.manifestUrl);
    assert.doesNotMatch(manifest.headers.get("cache-control") ?? "", /immutable/);
  });
});

describe("the preload links are the client's fetch plan", () => {
  for (const header of ["fr-CA,fr;q=0.9", "fr-CH", "de"]) {
    test(`Accept-Language: ${header}`, async () => {
      const { html } = await render(header);
      const stamp = stampFrom(html);
      const hrefs = preloadHrefs(html);
      assert.ok(hrefs.length > 0, "no preload links were emitted");

      /** @type {string[]} */
      const fetched = [];
      const manifest = parseStringsManifest(await (await fetch(shop.manifestUrl)).text());
      const loaded = await loadStrings(manifest, stamp.lookupLocale, {
        fetch: /** @type {typeof fetch} */ (/** @type {any} */ ((input, init) => {
          fetched.push(String(input));
          return fetch(input, init);
        })),
      });

      // URL FOR URL AND IN ORDER. `requestedFiles` is the plan; `fetched` is what actually left the
      // client. Comparing the preloads to both is what makes this a seam test rather than a
      // restatement of `fetchSet`.
      assert.deepEqual(loaded.requestedFiles.map((entry) => entry.url), hrefs);
      assert.deepEqual(fetched, hrefs);
      // ONE REQUEST PER CATALOG — plan 6.3:2184's "M8 proves one network request, not merely a
      // successful second fetch", asserted here for the client the preload was emitted for.
      assert.equal(new Set(fetched).size, fetched.length, "a catalog was fetched twice");
    });
  }

  test("the preload's CORS mode is the one the loader actually uses", async () => {
    // Plan 6.3:2179-2183 lists FOUR things that must match for a preload to be reused — url,
    // destination, CORS mode and credentials mode — and Node can check three of them. The fourth,
    // whether the browser genuinely reuses the entry, is a browser property and is why clause 24 is
    // held rather than claimed.
    //
    // `crossorigin` with NO VALUE is the anonymous mode, and the plan says outright that "anonymous
    // preload matches the default loader" while "a custom `credentials: \"include\"` path requires
    // `crossorigin=\"use-credentials\"`". So the attribute and the loader's default are one claim in
    // two places, and this is where they meet.
    const { DEFAULT_REQUEST } = await import("../src/load/fetch-loader.js");
    assert.deepEqual({ ...DEFAULT_REQUEST }, { mode: "cors", credentials: "same-origin" },
      "the loader's default is no longer the anonymous mode the emitted `crossorigin` declares");

    const { html } = await render("fr-CH");
    for (const link of html.match(/<link rel="preload"[^>]*>/g) ?? []) {
      assert.match(link, / crossorigin>/, "bare `crossorigin` is the anonymous mode");
      assert.doesNotMatch(link, /crossorigin=/, "a VALUE here would be claiming a different mode");
    }
  });

  test("every preload is anonymous, typed, and `as=fetch`", async () => {
    const { html } = await render("fr-CH");
    for (const link of html.match(/<link rel="preload"[^>]*>/g) ?? []) {
      // Plan 6.3:2179-2181: destination, type and CORS mode must match the later fetch or the
      // preload is not reused. The default loader is anonymous, so `crossorigin` carries no value.
      assert.match(link, /as="fetch"/);
      assert.match(link, /type="application\/json"/);
      assert.match(link, / crossorigin>/);
    }
  });
});

describe("the stamp crosses from a file:-loaded server to an https:-loaded client", () => {
  for (const header of ["fr-CA,fr;q=0.9", "fr-CH", "de", "fr;q=2"]) {
    test(`Accept-Language: ${JSON.stringify(header)} hydrates`, async () => {
      const { html } = await render(header);
      const stamp = stampFrom(html);

      const manifest = parseStringsManifest(await (await fetch(shop.manifestUrl)).text());
      const loaded = await loadStrings(manifest, stamp.lookupLocale);
      const client = createStrings({ loaded, locale: stamp.lookupLocale });

      // The client holds only the NARROW projection — selected locale and match type — which is all
      // the stamp is allowed to carry. Plan 6.4:2267-2270: it "never leaks requested ranges,
      // q-values, fallback configuration, or the supported/considered locale inventory".
      const context = stamp.localeMatch.matchType === "exact" && stamp.localeMatch.locale === null
        ? { kind: /** @type {const} */ ("locale"), locale: stamp.lookupLocale }
        : { kind: /** @type {const} */ ("locale-match"), localeMatch: stamp.localeMatch };
      validateSsrStamp(stamp, client, context);

      // ANTI-VACUITY: a validation that accepts anything proves nothing about the one above.
      assert.throws(() => validateSsrStamp(
        { ...stamp, catalogFingerprint: "0".repeat(64) }, client, context));
    });
  }

  test("the stamp carries no requested range, weight, or considered inventory", async () => {
    const { html } = await render("fr-CH,fr;q=0.9,en;q=0.1");
    const serialized = JSON.stringify(stampFrom(html));
    for (const leak of ["fr-ch", "consideredLocales", "requestedLanguageRanges", "0.9"])
      assert.ok(!serialized.includes(leak), `the stamp leaks ${leak}`);
  });
});

describe("the negotiated document is cached the way plan 6.4 allows", () => {
  test("it varies on Accept-Language", async () => {
    const { response } = await render("fr-CH");
    assert.equal(response.headers.get("vary"), "Accept-Language");
  });

  test("and the header genuinely changes the bytes, so the Vary is load-bearing", async () => {
    const swiss = await render("fr-CH");
    const belgian = await render("fr-BE");
    assert.notEqual(swiss.html, belgian.html);
    assert.deepEqual(stampFrom(swiss.html), stampFrom(belgian.html),
      "the two stamps are identical, which is why `Vary` and not the stamp is what separates them");
  });
});

describe("one instance per catalog version, not one per request", () => {
  test("`createStrings` is called from `startBookshop`, never from the request path", () => {
    // Plan 6.6:2354 — "Servers keep an immutable instance ... per catalog version". A server that
    // rebuilt per request renders identically and passes every assertion in this file, so the
    // property is checked where it is visible: in the source, through the TypeScript AST the same
    // way `tools/likely-subtag-consumers.mjs` derives its consumer list.
    const file = fileURLToPath(new URL("../examples/server/server.js", import.meta.url));
    const source = ts.createSourceFile(
      file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);

    /** @type {string[]} */
    const enclosing = [];
    /** @param {ts.Node} node @param {string} scope */
    const visit = (node, scope) => {
      let next = scope;
      if (ts.isFunctionDeclaration(node) && node.name) next = node.name.text;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === "createStrings") enclosing.push(scope);
      node.forEachChild((child) => visit(child, next));
    };
    visit(source, "<module>");

    assert.deepEqual(enclosing, ["startBookshop"],
      `createStrings is called from ${enclosing.join(", ")}`);
  });
});

describe("the edge worker runs against this server over real HTTP", () => {
  test("it negotiates, loads the subset and renders", async () => {
    const response = await handleRequest(
      new Request("https://bookshop.example/", { headers: { "accept-language": "fr-CA,fr;q=0.9" } }),
      { MANIFEST_URL: shop.manifestUrl });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /La librairie Lokalized du Canada/);
    assert.equal(response.headers.get("vary"), "Accept-Language");
    assert.match(response.headers.get("x-lokalized-cache-key") ?? "", /^lokalized-match:[0-9a-f]{64}$/);
  });

  test("and it renders the same translations the server did", async () => {
    const edge = await handleRequest(
      new Request("https://bookshop.example/", { headers: { "accept-language": "fr-CH" } }),
      { MANIFEST_URL: shop.manifestUrl });
    const edgeBody = await edge.text();
    const { html } = await render("fr-CH");
    // The server's document carries preloads and a stamp the worker does not emit, so the documents
    // differ; every translated line must not.
    // The diagnostics line is IN this list deliberately: it carries `isFallback`, and without it a
    // door that discarded the match it negotiated would agree with one that preserved it.
    for (const line of ["<h1>", 'class="notice"', 'class="cart"', 'class="greeting"', 'class="diagnostics"']) {
      const fromEdge = edgeBody.split("\n").find((l) => l.includes(line));
      const fromServer = html.split("\n").find((l) => l.includes(line));
      assert.equal(fromEdge, fromServer, `the two doors disagree on ${line}`);
    }
  });
});
