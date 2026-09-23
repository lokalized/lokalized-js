// @ts-check
/**
 * M8 CLAUSE 70's LOAD-ONLY WORKER — plan 6.5:2344, "M8 proves a load-only worker graph".
 *
 * It imports the root and `lokalized/load` and NOTHING from `lokalized/negotiate`, and
 * `tools/worker-smoke.mjs` hands the runtime exactly those two graphs and no others. So the
 * containment claim is made by the RUNTIME'S OWN MODULE LOADER rather than by a scan: were anything
 * here, or anything the load graph reaches, to import negotiation code, workerd would refuse to start
 * the worker with "No such module".
 *
 * Each capability plan 6.5 names is exercised on a real path rather than asserted: the manifest and
 * catalogs arrive by `fetch`; the loader reads bodies as STREAMS and bounds them while streaming (the
 * `limit` probe); it verifies each body's SHA-256 with WebCrypto before parsing (the `tampered`
 * probe); `AbortController` cancels the load (the `abort` probe); and `TextDecoder` decodes the
 * verified bytes inside the parser on every successful load.
 *
 * `runtime` reports `navigator.userAgent`, so the smoke test can show the answer came from the
 * runtime it names. Everything else in the body must be byte-identical to the same module run by
 * Node over the same packed package, which is the comparison that makes "it ran" mean "it agreed".
 */
import { createStrings } from "lokalized";
import { loadStrings } from "lokalized/load";

export default {
  /**
   * @param {Request} request
   * @param {{ MANIFEST_URL: string, TAMPERED_MANIFEST_URL: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const locale = url.searchParams.get("locale") ?? "fr";
    const limit = url.searchParams.get("limit");
    const controller = new AbortController();
    const manifestUrl = url.searchParams.has("tampered") ? env.TAMPERED_MANIFEST_URL : env.MANIFEST_URL;

    // `globalThis.navigator` because Node 20 — the floor CI tests — has no `navigator` at all.
    /** @type {Record<string, unknown>} */
    const body = { runtime: globalThis.navigator?.userAgent ?? null };
    try {
      const manifest = await (await fetch(manifestUrl)).json();
      // Aborted AFTER the manifest arrives, so it is the LOADER's handling of the signal under test
      // rather than the platform's refusal of a pre-aborted fetch.
      if (url.searchParams.has("abort")) controller.abort(new Error("aborted by the smoke test"));
      const loaded = await loadStrings(manifest, locale, {
        signal: controller.signal,
        ...(limit === null ? {} : { limits: { maximumInputBytes: Number(limit) } }),
      });
      const strings = createStrings({ loaded, locale });
      Object.assign(body, {
        outcome: "rendered",
        requested: loaded.requestedFiles.map((file) => file.locale),
        complete: loaded.complete,
        rendered: strings.get("Cart.Items", { count: 3 }),
      });
    } catch (error) {
      const failure = /** @type {any} */ (error);
      Object.assign(body, {
        outcome: "refused",
        error: failure?.name ?? String(failure),
        code: failure?.code ?? null,
        failures: (failure?.failures ?? []).map((/** @type {any} */ f) => ({ locale: f.locale, stage: f.stage })),
      });
    }
    return Response.json(body);
  },
};
