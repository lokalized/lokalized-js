# Executed examples

Two deployments of one bookshop, sharing one view and one set of catalogs:

| | |
|---|---|
| [`server/`](server/) | Node SSR. Negotiates once per request, renders, stamps, and emits `<link rel="preload">` for exactly the files the client will fetch. Publishes the manifest and the digest-bound catalog URLs the edge worker and the browser both read. |
| [`edge/`](edge/) | A worker-shaped `fetch` handler. Negotiates from the request header against the manifest alone, loads only the selected locale's subset, and takes one of two arms: redirect to a locale-keyed URL, or preserve the whole-list match and key the response by a fingerprint of it. |
| [`app/`](app/) | The view and the cache-key policy. Shared by both, and therefore inside the edge worker's module graph — which is why nothing here may import a Node built-in. |
| [`catalogs/`](catalogs/) | `en`, `fr`, `fr-CA`, `es`. Real Lokalized string files: a cardinality plural, a gender selector, and one key deliberately missing from `fr-CA` so per-key fallback is visible rather than assumed. |

```bash
npm run example:server        # a real server on $PORT (default 8787)
npm test                      # runs both examples end to end
npm run check:examples        # typechecks them as consumer TypeScript would
```

## These are gates, not illustrations

Plan 6.5 does not describe demo code; it describes properties, and the tests beside these files
assert them one by one — `test/example-edge.test.js`, `test/example-server.test.js` and
`test/example-graphs.test.js`. Twenty-two ablations were run against a throwaway copy while they
were written: twenty-one turned a named test red on the first attempt, and the one that did not
fire is why `test/example-edge.test.js` now asserts `isFallback` (rendering with `forLocale` instead
of `forLocaleMatch` had been invisible to every other assertion, because the worker already uses the
selected locale as its lookup).

The sharpest of them is the cache key. `Accept-Language: fr-CH` and `Accept-Language: fr-BE` both
select `fr` by the same `cldr-fallback` match type, so the selected locale, the match type, and the
whole serialized SSR stamp are identical for the two — and the rendered pages are not, because the
view names the range the visitor sent. A cache keyed on any of those three serves one visitor the
other's page. See [`app/cache-policy.js`](app/cache-policy.js).

## Two things these examples found

**The library's own load-then-construct pipeline did not typecheck.** `run-plan.js` annotated its
accumulator `Record<string, unknown>`, so the record every loader returns was not assignable to the
`loaded` option every loader exists to feed — `TS2322`, for every TypeScript consumer, with all
1,400-odd JavaScript tests green. Compiling these examples under `--strict` is what surfaced it, and
`tools/declaration-probes/run.mjs` now carries a probe that derives its record from the loader's own
return type rather than declaring one.

**The manifest generator cannot emit immutable URLs.** Plan 6.3 wants the preload to name
"exact digest-bound immutable files"; `createStringsManifestFromDirectory` publishes
`<locale>.json` and has no option for anything else, so [`server/publish.js`](server/publish.js)
renames them itself. That is safe — the catalog identity excludes every URL by design — but it is a
step every deployment has to repeat.

## What is not here yet

The worker smoke test plan 6.5:2343 asks for runs **from the packed artifact**, and that build is
deferred to M-R. Until it exists, "no Node-only code in the edge graph" is enforced structurally by
`test/example-graphs.test.js`, which walks the worker's transitive imports and uses the server
example — which legitimately imports `node:http` and `lokalized/node` — as the control that proves
the walk can see what it forbids.

The examples are deliberately **not** in `package.json#files`: the published tarball is the delivery
graph the size scenarios measure, and a Node server does not belong in it.
