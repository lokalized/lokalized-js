#!/usr/bin/env node
// @ts-check
/**
 * Serves scenario 0b's measuring page. Tooling, never shipped.
 *
 * **THIS ORIGIN IS NOT THE SUBJECT.** 0b measures the PRODUCTION host; a page merely needs an origin
 * to run from. Everything the capture counts comes from `cdn.jsdelivr.net` — the library from
 * `/npm/lokalized@…/dist/browser/`, the catalogs from `/gh/lokalized/lokalized-js@<sha>/`, both
 * pinned immutably. A6 cut 0b rather than run it against a stand-in, so every captured row records
 * which origin it came from and the two local contributions are deliberate CONTROLS.
 *
 * **TWO PORTS, AND THE SECOND ONE IS THE WHOLE POINT OF THE BLIND CONTROL.** The first version
 * served the no-Timing-Allow-Origin control from the page's OWN origin, where that header is
 * irrelevant — a same-origin resource reports its sizes regardless, so the control could never have
 * been blind and proved nothing. It is served from a DIFFERENT PORT, which is a different origin,
 * so withholding `Timing-Allow-Origin` actually withholds the timing.
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8713);
const blindPort = port + 1;

const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8" };

/**
 * THE BLIND CONTROL, on its own origin. CORS is allowed so the fetch SUCCEEDS; it is the TIMING
 * that is withheld. If this resource ever reports a non-zero `encodedBodySize`, the capture is not
 * reading what it believes it is reading — so do not "fix" this by adding the header.
 */
createServer((_request, response) => {
  const body = JSON.stringify({ why: "cross-origin and served without Timing-Allow-Origin, so its size must read 0" });
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  response.end(body);
}).listen(blindPort, () => console.log(`scenario-0b blind control on http://localhost:${blindPort}`));

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  // The page POSTS its own capture here when it finishes, so the operator never has to copy a large
  // JSON blob out of a console by hand. The file is the recorder's input, nothing more.
  if (request.method === "POST" && url.pathname === "/capture") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    await writeFile(join(here, "capture.json"), Buffer.concat(chunks));
    response.writeHead(200, { "content-type": "text/plain" });
    return response.end("captured");
  }

  const name = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  if (!/^[a-z0-9.-]+$/i.test(name)) { response.writeHead(400); return response.end("bad path"); }
  // NO TOKEN, NO RUN. A cold run is spent the moment the page imports the library, because the
  // chunks then sit in this site's cache partition for a year — and a preview tool opening the bare
  // origin, or a stray reload, would spend it on a run nobody chose. So the measuring page is served
  // only when the operator has named the run.
  if (name === "index.html" && !url.searchParams.has("run")) {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    return response.end("scenario 0b: nothing measured. Load /?run=<token> to take a run; see tools/scenario-0b.mjs.\n");
  }
  try {
    let bytes = await readFile(join(here, name));
    // THE RUN TOKEN IS SUBSTITUTED AS THE PAGE IS SERVED. It must reach the preload hrefs before the
    // browser parses them: rewriting them from script fires every catalog twice, because a
    // parse-time preload starts before any module runs. Measured, that mistake: 11 requests -> 16.
    if (name === "index.html")
      bytes = Buffer.from(String(bytes).replaceAll("__RUN__", encodeURIComponent(url.searchParams.get("run") ?? "1")));
    response.writeHead(200, {
      "content-type": TYPES[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream",
      // The page is re-fetched every load: a warm module cache has no cold-import figure, which is
      // the reason 0a's harness gives for the same header. It does NOT help with jsDelivr, which
      // sends `immutable, max-age=31536000` and cannot be told otherwise — that is what the
      // cold-arm contamination check in the page exists for.
      "cache-control": "no-store",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}).listen(port, () => console.log(`scenario-0b harness on http://localhost:${port}`));
