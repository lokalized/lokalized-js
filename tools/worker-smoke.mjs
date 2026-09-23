#!/usr/bin/env node
// @ts-check
/**
 * THE WORKER SMOKE TEST — plan 6.5:2341-2344, in the NAMED runtime the maintainer chose: `workerd`
 * (A29, 2026-09-22), Cloudflare's open-source Workers runtime, pinned exactly in `devDependencies`.
 *
 * Plan 6.5: the edge example "requires Fetch, response streams, `AbortController`, `TextDecoder`,
 * and WebCrypto, and is smoke-tested in at least one named worker runtime from the packed artifact
 * ... M8 proves a load-only worker graph; M9 owns this full negotiation example and its combined
 * smoke test." This runs BOTH:
 *
 *   load-only  `tools/worker-smoke/load-only.js` — the root plus `lokalized/load`, nothing from
 *              `lokalized/negotiate` (M8 clause 70);
 *   edge       `examples/edge/worker.js`, UNMODIFIED, under both of its strategies (M9 clause 21).
 *
 * **FROM THE PACKED ARTIFACT, UNBUNDLED.** "Every release provides npm exports for Node and bundler
 * consumers", and "npm ships checked unbundled ESM" (plan 6.3). So this runs `npm pack`, installs
 * the tarball, and hands workerd the SHIPPED FILES themselves, each as its own module. A bundler in
 * between would rewrite them, and the one thing A24 recorded giving up was exactly this: "an
 * import-time failure specific to a real worker runtime would not be caught ... not the platform's
 * module loader". Here the platform's module loader reads every file the package ships.
 *
 * **THE LOAD-ONLY GRAPH IS FIXED, NOT DERIVED FROM THE WORKER.** Its module list is exactly the
 * packed graphs of `src/index.js` and `src/load/index.js`, so a worker that imported negotiation code
 * would fail to START in workerd — "No such module" — rather than quietly widening the list. The same
 * containment is also asserted over the derived file list, so a `load` graph that grew to reach
 * `src/negotiate/` fails here too.
 *
 * **"IT RAN" IS NOT THE ASSERTION; "IT AGREED" IS.** Every probe is answered twice — by workerd, and
 * by Node importing the same worker module over the same installed package with the same origin —
 * and the application-level response (status, headers, body) must be byte-identical. A runtime that
 * rendered something plausible and different would otherwise pass. Absolute checks sit beside the
 * comparison, because two runtimes agreeing on a broken answer is agreement, not correctness: the
 * rendered text is not a raw key, a tampered catalog is refused at stage `digest`, a body one byte
 * over its limit at stage `limit`, an aborted load is refused, the redirect arm redirects. And the
 * load-only worker reports `navigator.userAgent`, which must be workerd's — so the workerd column is
 * shown to come from workerd.
 *
 * **WHAT IT DOES NOT COVER, said here.** One runtime, one platform binary per CI host. Transport-level
 * headers workerd's HTTP server adds (`content-length` and the like) are excluded from the comparison
 * because Node's in-process `Response` never serializes; everything the APPLICATION sets is compared.
 * Bare specifiers like `lokalized/load` are resolved by this tool (workerd resolves a bare specifier
 * relative to the importing module, and a real deployment's bundler resolves them from `exports`);
 * the library's own imports are all relative, as plan 6.3 requires, and are resolved by workerd.
 *
 *   node tools/worker-smoke.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { graphBytes } from "./graph-walk.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKERD = join(root, "node_modules", ".bin", "workerd");
/**
 * TWO COMPATIBILITY DATES, and the pair was chosen by a measurement. At a CURRENT date workerd
 * supplies `node:fs`, `node:crypto` and the rest — measured at 2026-09-01, 106 exports on `node:fs`
 * over a virtual filesystem — so the runtime cannot enforce plan 6.5's "Node-only code is forbidden
 * from the graph": `import "node:fs"` added to the edge example left this tool's first version GREEN.
 * At 2024-01-01 workerd refuses that import ("No such module") and the whole library still runs. So
 * every probe runs at both: the old date makes the RUNTIME refuse Node code, and the current date is
 * what a new deployment would actually use. workerd refuses a date later than its own build; both are
 * pinned so a run is reproducible.
 */
const COMPATIBILITY_DATES = ["2024-01-01", "2026-09-01"];
const ORIGIN = "http://catalogs.test/";

/** @type {string[]} */
const problems = [];
const say = (/** @type {string} */ line) => console.log(line);

if (!existsSync(WORKERD)) {
  // A FAILURE, NOT A SKIP. A smoke test that quietly passes when its runtime is absent has stopped
  // testing, and CI fails on a skip for exactly that reason.
  console.error("workerd is not installed (node_modules/.bin/workerd). It is a pinned devDependency: run `npm ci`.");
  process.exit(1);
}
const workerdVersion = execFileSync(WORKERD, ["--version"], { encoding: "utf8" }).trim();

const work = mkdtempSync(join(tmpdir(), "lokalized-worker-smoke-"));
/** @type {import("node:child_process").ChildProcess | null} */
let runtime = null;
process.on("exit", () => { runtime?.kill(); rmSync(work, { recursive: true, force: true }); });

// ---- 1. The packed artifact, installed where a deployment's code would find it. -----------------
const bundle = join(work, "bundle");
const installed = join(bundle, "node_modules", "lokalized");
mkdirSync(installed, { recursive: true });
const tarballDir = join(work, "tarball");
mkdirSync(tarballDir);
const packed = execFileSync("npm", ["pack", "--pack-destination", tarballDir, "--silent"],
  { cwd: root, encoding: "utf8" }).trim().split("\n").pop() ?? "";
execFileSync("tar", ["-xzf", join(tarballDir, packed), "-C", installed, "--strip-components", "1"]);
writeFileSync(join(bundle, "package.json"), '{ "type": "module" }\n');

// The APPLICATION's code comes from the repository — `examples/` is not in the tarball, and it is the
// application rather than the library. Copied under `bundle/` so that Node resolves its bare
// `lokalized/...` imports to the PACKED package, exactly as workerd will.
const APP_FILES = ["examples/edge/worker.js", "examples/app/render.js", "examples/app/cache-policy.js",
  "examples/server/publish.js", "tools/worker-smoke/load-only.js"];
for (const file of APP_FILES) {
  mkdirSync(dirname(join(bundle, file)), { recursive: true });
  cpSync(join(root, file), join(bundle, file));
}
cpSync(join(root, "examples", "catalogs"), join(bundle, "examples", "catalogs"), { recursive: true });

// ---- 2. The origin: the example's own publisher, run over the packed package. -------------------
const originDir = join(work, "origin");
mkdirSync(originDir);
const { publishCatalogs } = await import(pathToFileURL(join(bundle, "examples/server/publish.js")).href);
const { manifest, assets } = await publishCatalogs({ catalogVersion: "worker-smoke", publicationBaseUrl: ORIGIN });
writeFileSync(join(originDir, "manifest.json"), JSON.stringify(manifest, null, 2));
for (const [path, bytes] of assets) writeFileSync(join(originDir, path), bytes);

// A TAMPERED twin of `fr`: one byte changed, SAME LENGTH, so it passes the declared-size check and
// can only be refused by the digest. (A length change would be refused at stage `limit` first — the
// `zh-123` shape M-D S18 hit with "alice"/"mallory".)
const frEntry = manifest.files.fr;
const frPath = new URL(frEntry.url).pathname.slice(1);
const frBytes = new Uint8Array(readFileSync(join(originDir, frPath)));
const tampered = frBytes.slice();
const at = tampered.indexOf("V".charCodeAt(0));
if (at < 0) throw new Error("the fr catalog has no 'V' to tamper with; pick another byte");
tampered[at] = "W".charCodeAt(0);
writeFileSync(join(originDir, "fr.tampered.json"), tampered);
writeFileSync(join(originDir, "manifest-tampered.json"), JSON.stringify({
  ...manifest, files: { ...manifest.files, fr: { ...frEntry, url: `${ORIGIN}fr.tampered.json` } },
}, null, 2));
const frDecodedBytes = frBytes.length;

// ---- 3. The module graphs, derived from the PACKED files. -------------------------------------
const libraryGraph = (/** @type {string[]} */ entries) =>
  [...new Set(entries.flatMap((entry) => graphBytes(installed, entry).files))].sort();
const loadOnlyLibrary = libraryGraph(["src/index.js", "src/load/index.js"]);
const edgeLibrary = libraryGraph(["src/index.js", "src/core/index.js", "src/load/index.js", "src/negotiate/index.js"]);

const intoNegotiate = loadOnlyLibrary.filter((file) => file.includes(`${join("src", "negotiate")}/`));
if (intoNegotiate.length > 0)
  problems.push(`the load-only graph reaches negotiation code: ${intoNegotiate.map((f) => relative(installed, f)).join(", ")}`);
for (const graph of [loadOnlyLibrary, edgeLibrary]) {
  const nodeOnly = graph.filter((file) => file.includes(`${join("src", "node")}/`));
  if (nodeOnly.length > 0) problems.push(`a worker graph reaches Node-only code: ${nodeOnly.join(", ")}`);
}
if (!edgeLibrary.some((file) => file.includes(`${join("src", "negotiate")}/`)))
  problems.push("the edge graph contains no negotiation module, so the two workers are not being told apart");

/** The package's own `exports`, which is what a deployment's bundler would resolve from. */
const EXPORTS = { "lokalized": "src/index.js", "lokalized/core": "src/core/index.js",
  "lokalized/load": "src/load/index.js", "lokalized/negotiate": "src/negotiate/index.js" };
const packageExports = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).exports;
for (const [specifier, target] of Object.entries(EXPORTS)) {
  const key = specifier === "lokalized" ? "." : `./${specifier.slice("lokalized/".length)}`;
  if (packageExports[key]?.import !== `./${target}`)
    problems.push(`${specifier} resolves to ${packageExports[key]?.import} in the packed package, not ./${target}`);
}

/**
 * A workerd worker. `app` is the application's main module and whichever of its siblings it imports;
 * `library` is the fixed set of library files it may use; `allowed` is which bare specifiers get an
 * alias. A bare import outside `allowed` gets NO alias, so workerd refuses it at startup.
 */
function worker(/** @type {{ main: string, library: string[], allowed: string[], bindings: Record<string, string> }} */ spec,
  /** @type {string} */ date) {
  // THE MAIN MODULE FIRST: workerd takes the first listed module as the worker's entry and reads
  // its exports as handlers. The walk returns files SORTED, which put `examples/app/cache-policy.js`
  // first on the first run — and workerd refused its `MATCH_PRESERVING_VARY` export as a handler.
  const mainFile = join(bundle, spec.main);
  const app = [mainFile, ...graphBytes(bundle, spec.main).files.filter((file) => file !== mainFile)];
  /** @type {{ name: string, file: string }[]} */
  const modules = app.map((file) => ({ name: relative(bundle, file), file: relative(bundle, file) }));
  mkdirSync(join(bundle, "_alias"), { recursive: true });
  for (const file of app) {
    const text = readFileSync(file, "utf8");
    for (const specifier of new Set([...text.matchAll(/from\s*"(lokalized(?:\/[a-z/]+)?)"/g)].map((m) => m[1]))) {
      if (!spec.allowed.includes(specifier)) continue;
      const alias = `_alias/${modules.length}.js`;
      writeFileSync(join(bundle, alias), `export * from "/node_modules/lokalized/${EXPORTS[/** @type {keyof typeof EXPORTS} */ (specifier)]}";\n`);
      modules.push({ name: join(dirname(relative(bundle, file)), specifier), file: alias });
    }
  }
  for (const file of spec.library) modules.push({ name: relative(bundle, file), file: relative(bundle, file) });
  const q = JSON.stringify;
  return `(
    modules = [
${modules.map((m) => `      (name = ${q(m.name)}, esModule = embed ${q(`bundle/${m.file}`)}),`).join("\n")}
    ],
    compatibilityDate = ${q(date)},
    bindings = [
${Object.entries(spec.bindings).map(([name, text]) => `      (name = ${q(name)}, text = ${q(text)}),`).join("\n")}
    ],
    globalOutbound = "origin",
  )`;
}

const SERVICE_NAMES = /** @type {const} */ (["load-only", "edge-preserve", "edge-redirect"]);
const servicesFor = (/** @type {string} */ date) => ({
  "load-only": worker({ main: "tools/worker-smoke/load-only.js", library: loadOnlyLibrary,
    allowed: ["lokalized", "lokalized/load"],
    bindings: { MANIFEST_URL: `${ORIGIN}manifest.json`, TAMPERED_MANIFEST_URL: `${ORIGIN}manifest-tampered.json` } }, date),
  "edge-preserve": worker({ main: "examples/edge/worker.js", library: edgeLibrary, allowed: Object.keys(EXPORTS),
    bindings: { MANIFEST_URL: `${ORIGIN}manifest.json`, LOCALE_STRATEGY: "preserve" } }, date),
  "edge-redirect": worker({ main: "examples/edge/worker.js", library: edgeLibrary, allowed: Object.keys(EXPORTS),
    bindings: { MANIFEST_URL: `${ORIGIN}manifest.json`, LOCALE_STRATEGY: "redirect" } }, date),
});

// ---- 4. Start workerd at one date and learn its ports from the control descriptor. -------------
/** @type {Record<string, number>} */
let ports = {};
async function start(/** @type {string} */ date) {
  const q = JSON.stringify;
  const services = servicesFor(date);
  const configFile = `config-${date}.capnp`;
  writeFileSync(join(work, configFile), `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
${Object.entries(services).map(([name, body]) => `    (name = ${q(name)}, worker = ${body}),`).join("\n")}
    (name = "origin", disk = (path = ${q(originDir)}, writable = false)),
  ],
  sockets = [
${SERVICE_NAMES.map((name) => `    (name = ${q(name)}, address = "127.0.0.1:0", http = (), service = ${q(name)}),`).join("\n")}
  ],
);
`);
  ports = {};
  let stderr = "";
  const child = spawn(WORKERD, ["serve", configFile, "--control-fd=3"], { cwd: work, stdio: ["ignore", "ignore", "pipe", "pipe"] });
  runtime = child;
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  await new Promise((resolveReady, rejectReady) => {
    let control = "";
    const deadline = setTimeout(() => rejectReady(new Error(`workerd (${date}) did not report ${SERVICE_NAMES.length} listening sockets within 20 s.\n${stderr}`)), 20_000);
    child.on("exit", (code) => { clearTimeout(deadline); rejectReady(new Error(`workerd (${date}) exited with ${code} before listening:\n${stderr}`)); });
    /** @type {import("node:stream").Readable} */ (child.stdio[3]).on("data", (chunk) => {
      control += chunk;
      for (const line of control.split("\n")) {
        const event = (() => { try { return JSON.parse(line); } catch { return null; } })();
        if (event?.event === "listen") ports[event.socket] = event.port;
      }
      if (SERVICE_NAMES.every((name) => name in ports)) { clearTimeout(deadline); resolveReady(undefined); }
    });
  });
}
async function stop() {
  const child = runtime;
  runtime = null;
  if (child && child.exitCode === null) await new Promise((resolveExit) => { child.once("exit", resolveExit); child.kill(); });
}

// ---- 5. The Node reference: the same modules, the same package, the same origin. ---------------
const realFetch = globalThis.fetch;
/** Node's side of `globalOutbound`: every outbound fetch is served from the same origin directory. */
const originFetch = async (/** @type {RequestInfo | URL} */ input) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  try { return new Response(readFileSync(join(originDir, target.pathname.slice(1)))); }
  catch { return new Response("not found", { status: 404 }); }
};
const loadOnly = (await import(pathToFileURL(join(bundle, "tools/worker-smoke/load-only.js")).href)).default;
const edge = await import(pathToFileURL(join(bundle, "examples/edge/worker.js")).href);
const ENVIRONMENTS = {
  "load-only": { MANIFEST_URL: `${ORIGIN}manifest.json`, TAMPERED_MANIFEST_URL: `${ORIGIN}manifest-tampered.json` },
  "edge-preserve": { MANIFEST_URL: `${ORIGIN}manifest.json`, LOCALE_STRATEGY: "preserve" },
  "edge-redirect": { MANIFEST_URL: `${ORIGIN}manifest.json`, LOCALE_STRATEGY: "redirect" },
};
/** Headers the TRANSPORT adds when workerd serializes a response; Node's in-process Response has none. */
const TRANSPORT_HEADERS = new Set(["content-length", "date", "connection", "transfer-encoding", "keep-alive", "server"]);

/** @param {Response} response */
async function snapshot(response) {
  const headers = [...response.headers].filter(([name]) => !TRANSPORT_HEADERS.has(name.toLowerCase()))
    .map(([name, value]) => `${name.toLowerCase()}: ${value}`).sort();
  return { status: response.status, headers, body: await response.text() };
}

/**
 * workerd is called through `node:http`, NOT `fetch`, and the difference was measured: Node's `fetch`
 * ADDS `accept-language: *` to a request that has none, so the "no Accept-Language" probe reached
 * workerd with a header the Node side never saw, and the two answers differed for a reason in this
 * harness rather than in either runtime. `node:http` sends only what it is given.
 *
 * @param {number} port @param {string} path @param {Record<string, string>} headers
 * @returns {Promise<{ status: number, headers: string[], body: string }>}
 */
function viaHttp(port, path, headers) {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, headers }, (response) => {
      const chunks = /** @type {Buffer[]} */ ([]);
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveResponse({
        status: response.statusCode ?? 0,
        headers: Object.entries(response.headers).filter(([name]) => !TRANSPORT_HEADERS.has(name))
          .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`).sort(),
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", rejectResponse);
    request.end();
  });
}

/**
 * @param {typeof SERVICE_NAMES[number]} service
 * @param {string} path
 * @param {string | null} acceptLanguage
 */
async function probe(service, path, acceptLanguage) {
  /** @type {Record<string, string>} */
  const headers = acceptLanguage === null ? {} : { "accept-language": acceptLanguage };
  const viaWorkerd = await viaHttp(ports[service], path, headers);
  globalThis.fetch = /** @type {typeof fetch} */ (originFetch);
  let viaNode;
  try {
    const request = new Request(`http://127.0.0.1:${ports[service]}${path}`, { headers });
    const handler = service === "load-only" ? loadOnly.fetch : edge.default.fetch;
    viaNode = await snapshot(await handler(request, ENVIRONMENTS[service]));
  } finally {
    globalThis.fetch = realFetch;
  }
  return { viaWorkerd, viaNode };
}

// ---- 6. The probes. ---------------------------------------------------------------------------
/** @type {{ label: string, service: typeof SERVICE_NAMES[number], path: string, header: string | null, check?: (r: any) => string | null }[]} */
const PROBES = [
  // M8 clause 70 — the load-only graph, each capability on a real path.
  { label: "load-only, fr", service: "load-only", path: "/?locale=fr", header: null,
    check: (r) => r.outcome === "rendered" && r.complete === true && /3/.test(r.rendered) && r.rendered !== "Cart.Items"
      ? null : `expected a rendered fr string, got ${JSON.stringify(r)}` },
  { label: "load-only, en", service: "load-only", path: "/?locale=en", header: null,
    check: (r) => r.outcome === "rendered" && r.rendered !== "Cart.Items" ? null : `expected a rendered en string, got ${JSON.stringify(r)}` },
  { label: "load-only, WebCrypto refuses a tampered body", service: "load-only", path: "/?locale=fr&tampered", header: null,
    check: (r) => r.outcome === "refused" && r.failures?.some((/** @type {any} */ f) => f.locale === "fr" && f.stage === "digest")
      ? null : `expected fr refused at stage digest, got ${JSON.stringify(r)}` },
  { label: "load-only, the stream is bounded while it arrives", service: "load-only", path: `/?locale=fr&limit=${frDecodedBytes - 1}`, header: null,
    check: (r) => r.outcome === "refused" && r.failures?.some((/** @type {any} */ f) => f.locale === "fr" && f.stage === "limit")
      ? null : `expected fr refused at stage limit, got ${JSON.stringify(r)}` },
  { label: "load-only, at the limit the same body loads", service: "load-only", path: `/?locale=fr&limit=${frDecodedBytes}`, header: null,
    check: (r) => r.outcome === "rendered" ? null : `expected fr to load at exactly its size, got ${JSON.stringify(r)}` },
  { label: "load-only, AbortController cancels the load", service: "load-only", path: "/?locale=fr&abort", header: null,
    check: (r) => r.outcome === "refused" ? null : `expected the aborted load to be refused, got ${JSON.stringify(r)}` },
  // M9 clause 21 — the edge example, both strategies, unmodified.
  ...["fr-CH", "fr-BE", "fr-CH, fr;q=0.9, en;q=0.5", "fr-CA", "es-MX", "de", "fr;q=2", "*"].map((header) => ({
    label: `edge preserve, Accept-Language: ${header}`, service: /** @type {const} */ ("edge-preserve"), path: "/", header,
    check: (/** @type {any} */ r) => r.status === 200 ? null : `expected 200, got ${r.status}` })),
  { label: "edge preserve, no Accept-Language", service: "edge-preserve", path: "/", header: null,
    check: (r) => r.status === 200 ? null : `expected 200, got ${r.status}` },
  ...["/fr/", "/fr-CA/", "/en/", "/es/"].map((path) => ({
    label: `edge direct ${path}`, service: /** @type {const} */ ("edge-preserve"), path, header: "de",
    check: (/** @type {any} */ r) => r.status === 200 ? null : `expected 200, got ${r.status}` })),
  ...["fr-CH", "es-MX", "de", "fr;q=2"].map((header) => ({
    label: `edge redirect, Accept-Language: ${header}`, service: /** @type {const} */ ("edge-redirect"), path: "/", header,
    check: (/** @type {any} */ r) => r.status === 302 && r.headers.some((/** @type {string} */ h) => h.startsWith("location: /"))
      ? null : `expected a 302 with a location, got ${r.status} ${r.headers.join("; ")}` })),
];

const RAW_KEY = /\b(?:App|Cart|Checkout|Greeting)\.[A-Z][A-Za-z]+\b/;
let compared = 0;
/** @type {unknown} */ let runtimeSeen;
/** @type {unknown} */ let nodeRuntimeSeen;
for (const date of COMPATIBILITY_DATES) {
await start(date);
for (const { label: bare, service, path, header, check } of PROBES) {
  const label = `${date} ${bare}`;
  const { viaWorkerd, viaNode } = await probe(service, path, header);
  const isJson = service === "load-only";
  const w = isJson ? JSON.parse(viaWorkerd.body) : null;
  const n = isJson ? JSON.parse(viaNode.body) : null;
  if (isJson) {
    runtimeSeen = w.runtime;
    nodeRuntimeSeen = n.runtime;
    // The ONE field that must differ: it names the runtime that answered.
    delete w.runtime; delete n.runtime;
  }
  const same = isJson
    ? viaWorkerd.status === viaNode.status && JSON.stringify(w) === JSON.stringify(n)
    : JSON.stringify(viaWorkerd) === JSON.stringify(viaNode);
  if (!same) {
    problems.push(`${label}: workerd and Node disagree\n      workerd ${JSON.stringify(isJson ? w : viaWorkerd).slice(0, 400)}\n      node    ${JSON.stringify(isJson ? n : viaNode).slice(0, 400)}`);
    continue;
  }
  compared++;
  const verdict = check?.(isJson ? w : viaWorkerd);
  if (verdict) problems.push(`${label}: ${verdict}`);
  if (!isJson && RAW_KEY.test(viaWorkerd.body)) problems.push(`${label}: the page carries a raw key (${RAW_KEY.exec(viaWorkerd.body)?.[0]})`);
}
await stop();
}
if (runtimeSeen !== "Cloudflare-Workers")
  problems.push(`the load-only worker reported navigator.userAgent ${JSON.stringify(runtimeSeen)}, not workerd's "Cloudflare-Workers", so the workerd column may not be workerd`);
// AND THE OTHER COLUMN MUST BE A DIFFERENT RUNTIME, or every comparison above is a runtime compared
// with itself — green, and proving nothing about agreement.
if (nodeRuntimeSeen === undefined || nodeRuntimeSeen === runtimeSeen)
  problems.push(`the Node column reported ${JSON.stringify(nodeRuntimeSeen)}, so the two columns are not two runtimes`);

say(`worker smoke test — ${workerdVersion}, compatibility dates ${COMPATIBILITY_DATES.join(" and ")}, from the packed ${packed}`);
say(`  load-only worker   ${loadOnlyLibrary.length} library modules (root + lokalized/load), none from negotiate`);
say(`  edge worker        ${edgeLibrary.length} library modules, examples/edge/worker.js unmodified, preserve and redirect`);
say(`  ${compared}/${PROBES.length * COMPATIBILITY_DATES.length} probes (${PROBES.length} at each date) answered byte-identically by workerd and by Node`);
say(`  runtimes answering: ${JSON.stringify(runtimeSeen)} against ${JSON.stringify(nodeRuntimeSeen)}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
say("\nboth worker graphs run in workerd from the packed artifact and agree with Node on every probe.");
// EXPLICIT, because the running workerd child keeps the event loop alive: the first green run never
// ended, and a gate that hangs on success reads as a job timeout rather than a pass.
process.exit(0);
