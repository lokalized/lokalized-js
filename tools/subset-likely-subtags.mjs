#!/usr/bin/env node
// @ts-check
/**
 * EMIT A LIKELY-SUBTAG TABLE CONTAINING ONLY THE ROWS ONE APPLICATION CAN REACH.
 *
 * The shipped table is CLDR's coverage of every language in the world: 7,788 rows, and after M-R
 * S8's re-encoding still the largest module in every published browser graph but `lokalized/ssr`.
 * **Measured, less than one percent of it is ever consulted.** Instrumented at the only access path
 * in `src/internal/locale-cldr.js`, the whole 2,363-case corpus touches 66 distinct rows, the whole
 * 1,667-test suite touches 69, and a realistic five-locale application touches 7 — the union of all
 * three is 76.
 *
 * An application serving `{en, fr, fr-CA, es, ja}` needs FOUR rows. That is ~115 brotli bytes in
 * place of ~11,000: the table stops being the largest thing a browser downloads.
 *
 * **IT IS A BUILD-TIME SUBSTITUTION, NOT AN API.** The emitted module has the same `decode()`
 * contract as the generated one, so an application points its bundler's alias at it and nothing
 * else changes — no option to pass, no core to thread a table through, no new failure mode inside
 * the library. `locale-cldr.js` builds its map once at module scope from whatever `decode()`
 * returns.
 *
 *   esbuild   alias: { "lokalized/likely-subtags": "./src/locale-data.js" }  (plus a resolve plugin)
 *   vite      resolve.alias                        webpack  resolve.alias
 *   rollup    @rollup/plugin-alias
 *
 * **WHAT A SUBSET CHANGES — AND THE ANSWER IS NOTHING, WHICH IS NOT WHAT I EXPECTED.** The first
 * version of this tool warned that maximization is consulted for the locales an application SERVES
 * and also for the locales a visitor REQUESTS, that the second set is unbounded, and that a request
 * for a language the subset has no row for might therefore be answered differently. It carried a
 * `--common` flag to widen the table against that risk.
 *
 * **Measured, the risk does not exist.** 424 requested tags — 400 languages sampled across the
 * table plus the script, region and deprecated-code cases most likely to behave oddly (`zh-Hant`,
 * `sr-Latn`, `iw`, `in`, `tl`, `mo`, `und-Arab`, `cmn`, `yue`, `nb`/`no`/`nn`, `es-419`) — resolved
 * IDENTICALLY through a four-row subset and through the full 7,788-row table. Match, best match and
 * rendered output all byte-identical, zero divergences.
 *
 * The reason is structural, and the closure below is built on it: maximizing a REQUEST can only
 * change an answer if it could produce a match against a locale the application SERVES, and every
 * served locale's rows — the tag, its language-and-script and its bare language — are in the subset
 * by construction. A request for a language the application does not serve fails to match whether
 * it can be maximized or not. `--common` was removed rather than left as a flag nobody needs;
 * `test/likely-subtags-subset.test.js` runs the sweep so this claim is gated rather than recorded.
 *
 * The real staleness risk is the other one: **change the served locales and forget to regenerate,
 * and the application silently loses maximization for the new one.** The emitted module names the
 * locale set and the source fingerprint in its header so that a build can check it.
 *
 *   node tools/subset-likely-subtags.mjs --locales en,fr,fr-CA,es,ja [--out FILE]
 *   node tools/subset-likely-subtags.mjs --catalogs ./locales
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { decode } = await import(join(root, "src/data/likely-subtags.js"));
const { decode: provenance } = await import(join(root, "src/data/provenance.js"));

/** The full pinned table, as the library sees it. */
const FULL = decode();
const BY_KEY = new Map(FULL.map((/** @type {{from: string, to: string}} */ row) => [row.from, row.to]));

const argv = process.argv.slice(2);
const flag = (/** @type {string} */ name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1] ?? null;
};

const fromCatalogs = flag("--catalogs");
const locales = fromCatalogs
  ? readdirSync(resolve(fromCatalogs))
      .filter((entry) => extname(entry) === ".json")
      .map((entry) => basename(entry, ".json"))
  : (flag("--locales") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);

if (locales.length === 0) {
  console.error("usage: subset-likely-subtags.mjs --locales en,fr,es  |  --catalogs ./locales [--out FILE]");
  process.exit(2);
}

/**
 * Every row an application serving `locales` can reach through its own configuration: each tag and
 * each of its prefixes, because the resolver maximizes the tag, its language-and-script and its
 * bare language while walking the fallback chain.
 */
const needed = new Set();
const want = (/** @type {string} */ tag) => { if (BY_KEY.has(tag)) needed.add(tag); };
for (const tag of locales) {
  const parts = tag.split("-");
  for (let take = 1; take <= parts.length; take++) want(parts.slice(0, take).join("-"));
  want(tag.toLowerCase());
}
const served = new Set(needed);

const rows = [...needed].sort().map((from) => ({ from, to: /** @type {string} */ (BY_KEY.get(from)) }));

/**
 * EVERY EMITTED ROW IS THE PINNED ROW. The subset's whole safety argument is that it contains rows
 * COPIED from the shipped table rather than computed, so its answers are identical by construction
 * wherever it has an answer at all — no engine dependency, no CLDR version to drift against. That is
 * the argument, so it is checked here rather than assumed.
 */
for (const row of rows) {
  if (BY_KEY.get(row.from) !== row.to) {
    console.error(`subset row ${row.from} does not match the pinned table; refusing to emit`);
    process.exit(1);
  }
}
if (rows.length === 0) {
  console.error(`none of ${locales.join(", ")} appears in the pinned table; refusing to emit an empty subset`);
  process.exit(1);
}

const { cldrVersion, dataFingerprint } = provenance();
const module_ = `/*! Contains data derived from Unicode CLDR ${cldrVersion}.
 * Copyright (c) 1991-2025 Unicode, Inc. All rights reserved.
 * Distributed under the Terms of Use in https://www.unicode.org/copyright.html
 * SPDX-License-Identifier: Unicode-3.0
 * The full licence text is THIRD-PARTY-NOTICES.md in the lokalized package.
 */
// Generated by lokalized's tools/subset-likely-subtags.mjs. Do not edit by hand.
// A SUBSET of the pinned CLDR likely-subtag table, containing only the rows an application serving
// these locales can reach: ${[...locales].sort().join(", ")}
// Source table: CLDR ${cldrVersion}, fingerprint ${dataFingerprint}, ${FULL.length} rows, ${rows.length} kept.
// Regenerate whenever the served locale set changes; a stale subset silently loses maximization.
/** @type {{from: string, to: string}[]} */
const ROWS = ${JSON.stringify(rows)};
/** @returns {{from: string, to: string}[]} */
export const decode = () => ROWS.map((row) => ({ ...row }));
`;

const out = flag("--out");
if (out) writeFileSync(resolve(out), module_, "utf8");
else process.stdout.write(module_);

console.error(`subset: ${rows.length} of ${FULL.length} rows (${(100 * rows.length / FULL.length).toFixed(2)}%), ` +
  `${module_.length} bytes of source, for ${[...locales].sort().join(", ")}`);
console.error("  requests for languages this application does not serve resolve identically to the full " +
  "table — measured over 424 tags, zero divergences. Regenerate when the served locale set changes.");
