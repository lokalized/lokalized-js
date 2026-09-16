// @ts-check
/**
 * THE VIEW BOTH EXAMPLES SHARE — and it is shared on purpose, not to save typing.
 *
 * A real application renders the same markup on a server and at an edge; the two examples beside this
 * file differ in how a locale is CHOSEN and how the response is CACHED, never in what is drawn. Making
 * that literally true has two consequences worth stating, because both are load-bearing:
 *
 * 1. **This module is in the edge worker's module graph**, so the "no Node-only code in the edge
 *    graph" rule of plan 6.5:2343 has something real to bite on. A view that reaches for `node:path`
 *    to build a URL is the ordinary way that rule gets broken, and `tools/example-graphs.mjs` walks
 *    this file for exactly that reason. Nothing here may import a Node built-in.
 * 2. **`Locale.Notice` renders the RANGES THE VISITOR SENT**, not only the locale that was selected.
 *    That is the detail the cache-key half of plan 6.4 turns on: two visitors can send different
 *    `Accept-Language` headers, select the SAME locale by the SAME match type — and still be owed
 *    different bytes. `examples/app/cache-policy.js` says what follows from that; `test/example-edge.
 *    test.js` measures it. A view that ignored the request would make every key policy look correct.
 *
 * Both examples pass their locale decision in through `callOptions`, which is the whole difference
 * between the plan's two arms: `forLocale(tag)` is direct-locale mode (the redirect target), and
 * `forLocaleMatch(match)` preserves the whole-list match (the match-preserving response).
 */

/**
 * @typedef {import("lokalized/core").TranslationCallOptions} TranslationCallOptions
 * @typedef {ReturnType<typeof import("lokalized/core").createStrings>} Strings
 */

/**
 * The application's own view model. Everything here is an input to the rendered bytes, which is why
 * `cache-policy.js` takes the same object: a cache key that covers the match but not the view model
 * is the same defect one layer out.
 *
 * @typedef {Readonly<{
 *   callOptions: TranslationCallOptions,
 *   requestedRanges: readonly string[],
 *   servedLocale: string,
 *   cartCount: number,
 *   readerName: string,
 *   readerGender: unknown,
 *   stamp?: unknown,
 * }>} PageView
 */

const ESCAPES = /** @type {const} */ ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
});

/** @param {string} text */
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[/** @type {keyof typeof ESCAPES} */ (ch)]);
}

/**
 * Embed JSON inside `<script type="application/json">`. **Not `escapeHtml`.**
 *
 * A `script` element is raw text: the HTML parser does not decode character references inside it, so
 * `escapeHtml` would deliver a literal `&quot;` to the client and `JSON.parse(element.textContent)`
 * would throw. That is what this file used to do, and the test that read the stamp back un-escaped
 * five entities by hand — which made the defect look like a convention.
 *
 * What actually has to be neutralized is the one sequence that can END the element (`</script`) or
 * open a comment (`<!--`). Escaping every `<` as `\u003C` covers both and is still valid JSON, so
 * the client parses the raw text directly. U+2028/U+2029 are escaped for the benefit of anyone who
 * inlines this into a JavaScript literal instead.
 *
 * @param {string} json
 */
function escapeJsonForScript(json) {
  return json.replace(/</g, "\\u003C").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

/**
 * Render the page.
 *
 * `strings.get(key, placeholders, callOptions)` — the third slot is the per-call locale decision, and
 * passing the options into the SECOND slot silently renders the instance default instead of failing,
 * which is worth knowing about before it happens to you.
 *
 * @param {Strings} strings
 * @param {PageView} view
 * @returns {string} a complete HTML document
 */
export function renderPage(strings, view) {
  const { callOptions } = view;
  const title = strings.get("App.Title", undefined, callOptions);
  // TWO KEYS, CHOSEN BY WHETHER THERE IS A REQUEST TO SPEAK ABOUT. Direct-locale mode has discarded
  // the whole-list diagnostics by the time it gets here, so it renders a sentence that never mentions
  // them. The first draft of this file interpolated an English "nothing in particular" into whichever
  // language was being served, which is the kind of untranslated literal an example must not teach.
  const notice = view.requestedRanges.length === 0
    ? strings.get("Locale.Direct", { served: view.servedLocale }, callOptions)
    : strings.get("Locale.Notice", {
        requested: view.requestedRanges.join(", "), served: view.servedLocale,
      }, callOptions);
  const cart = strings.get("Cart.Items", { count: view.cartCount }, callOptions);
  const greeting = strings.get("Greeting", {
    name: view.readerName, readerGender: view.readerGender,
  }, callOptions);
  const cta = strings.get("Checkout.Cta", undefined, callOptions);

  // `getResult` rather than `get` for the diagnostics the page displays: which locale actually
  // supplied the bytes, and whether getting there needed a fallback. `resolvedLocale` is per-KEY,
  // so `Checkout.Cta` legitimately resolves somewhere `App.Title` did not — `fr-CA` in
  // `examples/catalogs/` deliberately omits that one key so the chain is visible rather than assumed.
  const ctaResult = strings.getResult("Checkout.Cta", undefined, callOptions);

  const stampScript = view.stamp === undefined ? "" :
    `\n  <script type="application/json" id="lokalized-ssr-stamp">${
      escapeJsonForScript(JSON.stringify(view.stamp))}</script>`;

  return `<!doctype html>
<html lang="${escapeHtml(view.servedLocale)}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>${stampScript}
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="notice">${escapeHtml(notice)}</p>
  <p class="cart">${escapeHtml(cart)}</p>
  <p class="greeting">${escapeHtml(greeting)}</p>
  <button>${escapeHtml(cta)}</button>
  <p class="diagnostics" data-resolved="${escapeHtml(ctaResult.resolvedLocale ?? "")}" data-fallback="${
    ctaResult.isFallback}">${escapeHtml(cta)} came from ${
    escapeHtml(ctaResult.resolvedLocale ?? "the key itself")}.</p>
</body>
</html>
`;
}
