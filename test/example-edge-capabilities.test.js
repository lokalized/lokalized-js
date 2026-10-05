// @ts-check
/**
 * "IT REQUIRES FETCH, RESPONSE STREAMS, `AbortController`, `TextDecoder`, AND WEBCRYPTO" — plan
 * 6.5:2342, turned from a sentence into a measurement.
 *
 * **WHY THIS FILE EXISTS.** `test/example-edge.test.js` exercises three of the five on a
 * discriminating fixture — WebCrypto through a same-length, still-parseable body with a wrong digest;
 * `AbortController` through a signal that must reach every read; streams through bodies that arrive
 * in two chunks. `TextDecoder` and `fetch` had NEITHER an ablation nor a discriminating fixture, and
 * M9's clause ledger holds clause 20 NOT-PROVEN for exactly that gap. The argument offered for the
 * gap was that "a graph using neither would fail to run at all rather than fail a named test" — which
 * is an argument that the property is UNTESTABLE, and it is wrong. It is testable by REMOVING the
 * capability and requiring the failure.
 *
 * **EACH PROBE RUNS IN ITS OWN CHILD PROCESS**, because a global has to be absent BEFORE the module
 * graph is imported and a test runner cannot un-import one. The control runs the same way with
 * nothing removed, so a probe that failed for a harness reason would fail the control too.
 *
 * **WHAT IS ATTRIBUTED AND WHAT IS NOT, said here rather than left to be assumed.** Removing
 * `crypto` produces `DigestUnavailableError` — the library's OWN named failure, raised inside
 * `lokalized/load`, which is the strongest row here and belongs unambiguously to the port. Removing
 * global `fetch` changes the failure from a network error to `transport is not a function`, which is
 * the worker's own `env.fetch ?? fetch`. The other rows are attributed to the DEPLOYMENT rather than
 * to one module: with `ReadableStream` absent a `Response` cannot carry a body at all, so the
 * worker, the loader and the test transport lose it together and no probe can separate them. That is
 * a true statement about what an edge runtime must provide, and a weaker one than the two above.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** Renders one request through the edge worker over an in-memory transport. */
const WITH_TRANSPORT = `
  const REPO = ${JSON.stringify(REPO)};
  try {
    const { publishCatalogs } = await import(REPO + "/examples/server/publish.js");
    const { handleRequest } = await import(REPO + "/examples/edge/worker.js");
    const BASE = "https://cdn.example/v1/";
    const published = await publishCatalogs({ catalogVersion: "cap", publicationBaseUrl: BASE });
    const manifestBytes = new TextEncoder().encode(JSON.stringify(published.manifest));
    const transport = async (input) => {
      const name = String(input).slice(BASE.length);
      const bytes = name === "manifest.json" ? manifestBytes : published.assets.get(name);
      return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes, { status: 200 });
    };
    const response = await handleRequest(
      new Request("https://x.example/", { headers: { "accept-language": "fr-CA,fr;q=0.9" } }),
      { MANIFEST_URL: BASE + "manifest.json", fetch: transport });
    const body = await response.text();
    process.stdout.write(JSON.stringify({ ok: true, status: response.status, rendered: body.includes("Canada") }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, name: error?.constructor?.name,
      message: String(error?.message).slice(0, 160) }));
  }
`;

/** The same worker with NO injected transport, so `env.fetch ?? fetch` must reach the global. */
const WITHOUT_TRANSPORT = `
  const REPO = ${JSON.stringify(REPO)};
  try {
    const { handleRequest } = await import(REPO + "/examples/edge/worker.js");
    const response = await handleRequest(new Request("https://x.example/"),
      { MANIFEST_URL: "https://127.0.0.1:1/manifest.json" });
    process.stdout.write(JSON.stringify({ ok: true, status: response.status }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, name: error?.constructor?.name,
      message: String(error?.message).slice(0, 160) }));
  }
`;

/**
 * @param {string} body @param {readonly string[]} removed
 * @returns {{ ok: boolean, status?: number, rendered?: boolean, name?: string, message?: string }}
 */
function run(body, removed) {
  const remove = removed
    .map((name) => `Object.defineProperty(globalThis, ${JSON.stringify(name)}, ` +
      `{ value: undefined, configurable: true, writable: true });`)
    .join("\n");
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `${remove}\n${body}`],
    { encoding: "utf8", maxBuffer: 1 << 20 });
  return JSON.parse(out.trim().split("\n").at(-1) ?? "{}");
}

describe("the five capabilities are REQUIRED, not merely mentioned", () => {
  test("the control renders, so every refusal below is the removal and not the harness", () => {
    const control = run(WITH_TRANSPORT, []);
    assert.deepEqual(control, { ok: true, status: 200, rendered: true });
  });

  // Each row is one capability plan 6.5:2342 names, or the concrete global that carries it.
  for (const capability of [
    "TextDecoder", "TextEncoder", "ReadableStream", "Response", "Request",
    "AbortController", "AbortSignal",
  ])
    test(`without \`${capability}\` the request fails rather than rendering`, () => {
      const result = run(WITH_TRANSPORT, [capability]);
      assert.equal(result.ok, false,
        `the worker rendered with ${capability} absent, so it does not require it`);
      assert.ok((result.message ?? "").length > 0, "the failure must say something");
    });

  test("without WebCrypto it fails CLOSED, with the library's own named error", () => {
    // The strongest row, and the only one attributable to a single module: `lokalized/load` raises
    // `DigestUnavailableError` rather than skipping verification, which is M8 clause 4's separation
    // seen from the deployment's side.
    const result = run(WITH_TRANSPORT, ["crypto"]);
    assert.equal(result.ok, false);
    assert.equal(result.name, "DigestUnavailableError");
    assert.match(result.message ?? "", /WebCrypto is unavailable/);
  });

  test("without global `fetch` the worker has no transport at all", () => {
    // `fetch` is the one capability an INJECTED transport hides: with `env.fetch` supplied the global
    // is never consulted, so the probe above renders happily without it. Removing the injection is
    // what makes the requirement observable.
    const withGlobal = run(WITHOUT_TRANSPORT, []);
    const withoutGlobal = run(WITHOUT_TRANSPORT, ["fetch"]);

    // BOTH fail — the control has no server at 127.0.0.1:1 — so the fact of failure proves nothing
    // and the MESSAGE is the discriminator.
    assert.equal(withGlobal.ok, false);
    assert.match(withGlobal.message ?? "", /fetch failed/,
      "with the global present the worker got as far as a network attempt");
    assert.equal(withoutGlobal.ok, false);
    assert.match(withoutGlobal.message ?? "", /transport is not a function/,
      "with the global absent it never reached one");
    assert.notEqual(withGlobal.message, withoutGlobal.message);
  });

  test("an injected transport does NOT hide the other four", () => {
    // ANTI-VACUITY for the rows above: every one of them was measured WITH a transport injected, so
    // none of them is secretly the `fetch` row wearing another name.
    const rendered = run(WITH_TRANSPORT, ["fetch"]);
    assert.deepEqual(rendered, { ok: true, status: 200, rendered: true },
      "with a transport injected the global fetch is genuinely unnecessary");
  });
});
