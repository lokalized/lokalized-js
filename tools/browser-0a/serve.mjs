#!/usr/bin/env node
// @ts-check
/**
 * Minimal static server for the scenario-0a browser measurement.
 *
 * Tooling, never shipped. It exists because ES module imports need an http origin — `file://` will
 * not resolve bare module graphs — and because the measurement must observe the SAME source files
 * the Node half measures, served unmodified with no bundler in the path. Scenario 0a is explicitly
 * "no manifest, Fetch, preload, or network-loader graph"; this serves static files and nothing else.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const port = Number(process.env.PORT ?? 8712);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const rel = url.pathname === "/" ? "/tools/browser-0a/index.html" : url.pathname;
  // Contain every request beneath the repo root; a measurement harness is still a server.
  const file = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(root)) { response.writeHead(403).end("forbidden"); return; }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      // Timing needs the resource entries to expose their sizes, and repeat runs must not be served
      // from cache or the import figures measure nothing.
      "timing-allow-origin": "*",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`scenario-0a harness on http://localhost:${port}`));
