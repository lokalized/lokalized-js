import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { startBookshop } from "../examples/server/server.js";

/**
 * M8 CLAUSE 81 / M9 CLAUSE 24 — the preload is REUSED, and the record that says so is held to the
 * code it was taken against.
 *
 * Plan 6.3:2179-2183 names four things that must match for a preload to be reused: url, destination,
 * CORS mode and credentials mode. Three are checkable here and `test/example-server.test.js` checks
 * them. **The fourth — whether a browser genuinely reuses the entry — is a browser property, and both
 * clauses were held on exactly that.** It is now measured, in `measurements/preload-reuse.json`:
 *
 *   matched preloads   fr-CA.json 1, fr.json 1, en.json 1   initiator `link`
 *   control (no crossorigin)   es.json 2                     initiators `link+fetch`
 *
 * One network request per URL for the matched set; two for an arm whose CORS mode deliberately does
 * not match, which Chrome names itself — "is found, but is not used because the request credentials
 * mode does not match". Without that arm, "one entry means reuse" would be unfalsifiable.
 *
 * **THIS FILE IS THE HALF THAT CAN RUN WITHOUT A BROWSER, and its job is to stop the record going
 * quietly stale.** A recorded measurement describes the code as it was; if the shipped preload
 * attributes move, the measurement no longer describes anything that ships. The attribute set is
 * deterministic and machine-independent, so unlike scenario 0a's source-graph figures this one
 * GATES — the reasoning `scenario:2k` uses for its catalog digest.
 */

const record = JSON.parse(readFileSync(new URL("../measurements/preload-reuse.json", import.meta.url), "utf8"));

/** A preload link's attributes, hrefs elided and sorted, so the comparison is order-independent. */
const attributeShape = (/** @type {string} */ link) =>
  [...link.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)]
    .slice(1)
    .map(([, name, value]) => (name === "href" ? "href" : value === undefined ? name : `${name}="${value}"`))
    .sort()
    .join(" ");

describe("the recorded preload measurement still describes the shipped server", () => {
  /** @type {{ origin: string, close?: () => Promise<void> | void }} */
  let shop;
  /** @type {string[]} */
  let links = [];

  before(async () => {
    shop = await startBookshop({ port: 0 });
    const html = await (await fetch(`${shop.origin}/`, { headers: { "accept-language": "fr-CA,fr;q=0.9" } })).text();
    links = html.match(/<link rel="preload"[^>]*>/g) ?? [];
  });
  after(async () => { await shop?.close?.(); });

  test("the server still emits preloads at all", () => {
    // Anti-vacuity first: every assertion below is over `links`, and an empty list satisfies all of
    // them. The fetch plan for `fr-CA` is three files.
    assert.equal(links.length, 3, "the preload set changed size; the recorded measurement covered three");
  });

  test("their attribute set is the one the browser measurement was taken against", () => {
    const shapes = [...new Set(links.map(attributeShape))];

    assert.deepEqual(shapes, [record.capturedAgainst.preloadAttributes],
      "the shipped preload attributes have moved, so measurements/preload-reuse.json describes code " +
      "that is no longer shipped. Re-drive the browser capture (its `procedure` field says how) " +
      "rather than editing the record");
  });

  test("the loader's default request is still the anonymous mode the attributes declare", async () => {
    // The other side of the same claim: `crossorigin` with no value is the anonymous mode, and it is
    // only a match while the loader's own default is `{mode:"cors", credentials:"same-origin"}`.
    const { DEFAULT_REQUEST } = await import("../src/load/fetch-loader.js");

    assert.deepEqual({ ...DEFAULT_REQUEST }, record.capturedAgainst.loaderDefaultRequest);
  });

  test("no preload carries an `integrity` attribute", () => {
    // Plan 6.3 keeps the SHA-256 check application-layer. Subresource Integrity would move it into
    // the browser, which fails the request instead of reporting a digest failure the loader can
    // attribute to a locale — and `test/example-edge.test.js` asserts that attribution.
    for (const link of links) assert.doesNotMatch(link, /integrity/);
    assert.equal(record.integrityAttribute.present, false);
  });
});

describe("the recorded measurement is one a reader can falsify", () => {
  test("it carries a control arm that was NOT reused", () => {
    // The load-bearing property of the record itself. A capture showing only 1-per-url would be
    // satisfied by a counter that cannot see a second request at all.
    const matched = Object.values(record.browser.matched.arms);
    const control = Object.values(record.browser.control.arms);

    assert.ok(matched.length >= 3, "fewer than three matched arms were recorded");
    assert.deepEqual([...new Set(matched)], [1], "a matched arm was recorded as more than one request");
    assert.ok(control.length >= 1, "no control arm was recorded, so 'one means reuse' is unfalsifiable");
    assert.ok(control.every((count) => count > 1), "the control arm was also reused, so it controls nothing");
    assert.match(record.browser.control.browserWarning, /is found, but is not used/);
  });

  test("it names the browser and the origin it was taken on", () => {
    assert.match(record.browser.userAgent, /Chrome\/\d+/);
    assert.match(record.browser.origin, /trustworthy origin/);
    assert.ok(record.procedure.includes("serve:0a"), "the record must say how to re-drive it");
  });
});
