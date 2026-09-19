// @ts-check
/**
 * THE SUBSET TABLE ANSWERS IDENTICALLY, PROVED BY RUNNING BOTH.
 *
 * `tools/subset-likely-subtags.mjs` emits a likely-subtag table holding only the rows one
 * application can reach — 4 rows instead of 7,788 for a five-locale app, which is the single
 * largest saving available to the browser build. Its safety argument is that every row is COPIED
 * from the pinned table rather than computed, so wherever the subset has an answer it is the same
 * answer.
 *
 * **THAT ARGUMENT IS CHECKED HERE RATHER THAN TRUSTED, AND BY THE MECHANISM AN APPLICATION USES.**
 * The subset is a build-time substitution: a bundler alias points the data module at the generated
 * one. So this bundles the SAME probe twice — once against the shipped table, once with the subset
 * aliased in — runs both in child processes, and compares their output. A test that swapped the
 * module inside this process would be checking something an application never does.
 *
 * **AND IT CHECKS THE DOCUMENTED DIVERGENCE TOO.** Maximization is consulted for the locales an
 * application serves AND for the locales a visitor requests; the second set is unbounded. A subset
 * built from the served locales alone therefore behaves differently for a request it has no row
 * for, and the tool says so. If that were not true the caveat would be superstition, so the third
 * test requires the divergence to EXIST — and the fourth requires `--common` to close it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = mkdtempSync(join(tmpdir(), "lokalized-subset-"));
after(() => rmSync(site, { recursive: true, force: true }));

const SERVED = ["en", "fr", "fr-CA", "es", "ja"];

/** Generate a subset module and return its path and the rows it carries. */
const subsetFor = (/** @type {string[]} */ locales, /** @type {number} */ common = 0) => {
  const out = join(site, `subset-${locales.join("_")}-${common}.js`);
  execFileSync(process.execPath, [
    join(root, "tools/subset-likely-subtags.mjs"), "--locales", locales.join(","),
    ...(common > 0 ? ["--common", String(common)] : []), "--out", out,
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  const text = readFileSync(out, "utf8");
  return { out, text, rows: JSON.parse(/const ROWS = (\[.*?\]);/s.exec(text)[1]) };
};

/**
 * The probe. It exercises the paths that consult maximization: construction over the served
 * catalogs, per-locale lookups, whole-list negotiation, and a bidi-sensitive render — the isolate
 * characters depend on the resolved locale's SCRIPT, which is exactly what maximization supplies.
 */
const PROBE = `
import { createStrings } from "CORE_PATH";
import { createLocaleNegotiator } from "NEGOTIATE_PATH";
const catalogs = Object.fromEntries(${JSON.stringify(SERVED)}.map((tag) => [tag, { K: tag + ": {{v}}" }]));
// The tiebreaker is the library's own requirement, not the subset's: {fr, fr-CA} is an ambiguous
// language code and construction refuses it without one. Both probes hit it identically.
const strings = createStrings({ strings: catalogs, fallbackLocale: "en", locale: "en",
  tiebreakers: { fr: ["fr", "fr-CA"] } });
const negotiator = createLocaleNegotiator({ fallbackLocale: "en", supportedLocales: ${JSON.stringify(SERVED)} });
const out = [];
for (const tag of ${JSON.stringify(SERVED)}) out.push(["render", tag, strings.get("K", { v: "x" }, { locale: tag })]);
for (const tag of REQUESTS) {
  let match; try { match = negotiator.matchFor(tag); } catch (error) { match = { error: String(error).slice(0, 40) }; }
  out.push(["match", tag, JSON.stringify(match)]);
  out.push(["best", tag, negotiator.bestMatchFor(tag)]);
}
for (const header of HEADERS) out.push(["accept", header, negotiator.bestMatchForAcceptLanguage(header)]);
out.push(["supported", "", strings.getSupportedLocales().join(",")]);
console.log(JSON.stringify(out));
`;

/** Bundle the probe with esbuild, optionally aliasing the data module, and run it. */
const runProbe = async (/** @type {string | null} */ subsetPath, /** @type {string[]} */ requests,
  /** @type {string[]} */ headers) => {
  const esbuild = await import("esbuild");
  // The probe imports the SOURCE paths rather than the package specifier: esbuild's `alias` maps a
  // bare name to a directory and cannot answer `lokalized/core`, which the first draft of this
  // harness discovered as four "Cannot read directory" errors rather than as a finding.
  const source = `const REQUESTS = ${JSON.stringify(requests)};\nconst HEADERS = ${JSON.stringify(headers)};\n`
    + PROBE.replace("CORE_PATH", join(root, "src/core/index.js")).replace("NEGOTIATE_PATH", join(root, "src/negotiate/index.js"));
  const plugins = subsetPath
    ? [{
        name: "subset",
        setup(/** @type {any} */ build) {
          build.onLoad({ filter: /data\/likely-subtags\.js$/ }, () => ({ contents: readFileSync(subsetPath, "utf8"), loader: "js" }));
        },
      }]
    : [];
  const built = await esbuild.build({
    stdin: { contents: source, resolveDir: site, sourcefile: "probe.js", loader: "js" },
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent", plugins,
  });
  const file = join(site, `probe-${subsetPath ? "subset" : "full"}-${requests.length}-${headers.length}.mjs`);
  writeFileSync(file, built.outputFiles[0].text, "utf8");
  return JSON.parse(execFileSync(process.execPath, [file], { encoding: "utf8" }));
};

describe("a subsetted likely-subtag table", () => {
  it("copies its rows verbatim from the pinned table", async () => {
    const { rows } = subsetFor(SERVED);
    const { decode } = await import("../src/data/likely-subtags.js");
    const pinned = new Map(decode().map((/** @type {any} */ row) => [row.from, row.to]));

    // ANTI-VACUITY FIRST: a subset of zero rows would satisfy every comparison below.
    assert.ok(rows.length >= 4, `the subset carries ${rows.length} row(s); the closure is broken`);
    assert.ok(rows.length < pinned.size / 100,
      `the subset carries ${rows.length} of ${pinned.size} rows, which is not a subset worth shipping`);
    for (const row of rows) assert.equal(row.to, pinned.get(row.from), `${row.from} does not match the pinned table`);
  });

  it("answers identically for everything the application serves", async () => {
    const { out } = subsetFor(SERVED);
    const requests = [...SERVED, "fr-BE", "fr-CH", "en-GB", "es-MX", "ja-JP"];
    const headers = ["fr-CA,fr;q=0.9,en;q=0.8", "es-MX,es;q=0.9", "ja,en;q=0.5"];
    const [full, subset] = await Promise.all([runProbe(null, requests, headers), runProbe(out, requests, headers)]);

    // The probe must have DONE something, or two empty transcripts compare equal.
    assert.ok(full.length >= 20, `the probe produced ${full.length} observations`);
    assert.ok(full.some((/** @type {any[]} */ row) => row[0] === "render" && row[2].includes("x")),
      "no render observation, so the bidi/script path was never exercised");
    assert.deepEqual(subset, full,
      "the subsetted table answers differently from the pinned one for locales the application serves");
  });

  it("answers identically for hundreds of languages it has NO row for", async () => {
    // **THIS TEST EXISTS BECAUSE ITS OPPOSITE FAILED.** It was written to require a DIVERGENCE: the
    // tool warned that a request for a language the subset cannot maximize might be answered
    // differently, and a warning nothing can falsify is superstition. Four probes did not diverge,
    // so the claim was swept properly instead of being explained away — 424 tags, zero divergences —
    // and the warning was deleted from the tool rather than left to reassure people.
    //
    // The reason is structural: maximizing a REQUEST can only change an answer if it could produce a
    // match against a locale the application SERVES, and every served locale's rows are in the
    // subset by construction. The sweep is kept at scale so the claim stays gated.
    const { out, rows } = subsetFor(SERVED);
    const { decode } = await import("../src/data/likely-subtags.js");
    const languages = decode()
      .map((/** @type {any} */ row) => row.from)
      .filter((/** @type {string} */ from) => /^[a-z]{2,3}$/.test(from));
    const step = Math.max(1, Math.floor(languages.length / 200));
    const requests = [
      ...languages.filter((/** @type {string} */ _, /** @type {number} */ i) => i % step === 0).slice(0, 200),
      "zh-Hant", "zh-Hans", "sr-Latn", "sr-Cyrl", "iw", "he", "in", "id", "tl", "fil", "mo", "ro",
      "pt-BR", "es-419", "und", "und-Arab", "cmn", "yue", "nb", "no", "nn",
    ];

    // ANTI-VACUITY: the sweep must be large, and must reach tags the subset genuinely lacks — or it
    // is comparing the table with itself.
    assert.ok(requests.length >= 200, `swept only ${requests.length} tags`);
    const held = new Set(rows.map((/** @type {any} */ row) => row.from));
    const absent = requests.filter((tag) => !held.has(tag.split("-")[0]));
    assert.ok(absent.length >= 150,
      `only ${absent.length} swept tags are outside the subset; the sweep is not testing the claim`);

    const [full, subset] = await Promise.all([runProbe(null, requests, []), runProbe(out, requests, [])]);
    assert.deepEqual(subset, full,
      "a four-row subset answered differently from the full 7,788-row table for a language it does not serve");
  });
});
