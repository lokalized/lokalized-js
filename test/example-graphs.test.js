// @ts-check
/**
 * "NODE-ONLY CODE IS FORBIDDEN FROM THE GRAPH" — plan 6.5:2343, checked mechanically.
 *
 * This is the one property of the edge example that a behavioural test cannot see. A worker that
 * imports `node:fs` renders exactly the same page under `node --test`, because the test runner IS
 * Node; the import only fails in the runtime the example claims to target, which is the one place
 * nobody is running it yet (the packed-artifact smoke test is deferred to M-R — plan :2341-2343
 * defines it as running FROM the packed build and M8's amendment A5 moved that build after M9).
 * So the rule is enforced STRUCTURALLY here, and the structural check is available today: the M9
 * scope map says so in as many words, and this is that check.
 *
 * **THE SERVER EXAMPLE IS THE CONTROL, and without it this file would be satisfied by a walker that
 * resolves nothing.** `examples/server/server.js` legitimately imports `node:http` and
 * `lokalized/node`; if the walk cannot see those it cannot see them in the worker either. That is
 * the anti-vacuity half, and it is not hypothetical: the same walk in `tools/graph-walk.mjs` once
 * reported 25 root modules while a 23 KB data table really was in the graph, because one import
 * SHAPE was not matched.
 *
 * The walk deliberately resolves BARE specifiers through the package's own `exports` map, which
 * `tools/graph-walk.mjs` does not need to do — everything under `src/` imports relatively. An
 * example is consumer-shaped code and writes `import { loadStrings } from "lokalized/load"`, so a
 * walker that only followed relative paths would report the worker's graph as four files and find
 * nothing at all.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { exampleGraph } from "../tools/example-graph-walk.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const edge = exampleGraph(ROOT, "examples/edge/worker.js");
const server = exampleGraph(ROOT, "examples/server/server.js");

describe("the edge example's module graph", () => {
  test("reaches no Node built-in", () => {
    assert.deepEqual(edge.builtins, [],
      "a Node built-in in the edge graph is invisible under `node --test` and fatal in a worker");
  });

  test("reaches nothing under src/node/ or examples/server/", () => {
    const forbidden = edge.files.filter((file) =>
      file.startsWith("src/node/") || file.startsWith("examples/server/"));
    assert.deepEqual(forbidden, []);
  });

  test("is not empty, and really does reach the library", () => {
    // ANTI-VACUITY: the two assertions above are both satisfied by a walk that resolved nothing.
    assert.ok(edge.files.length > 20, `the walk found only ${edge.files.length} modules`);
    for (const expected of [
      "examples/edge/worker.js", "examples/app/render.js", "examples/app/cache-policy.js",
      "src/index.js", "src/core/index.js", "src/load/index.js", "src/negotiate/index.js",
    ]) assert.ok(edge.files.includes(expected), `expected ${expected} in the edge graph`);
  });
});

describe("the server example's graph is the control that proves the walk can see what it forbids", () => {
  test("it reaches Node built-ins", () => {
    assert.ok(server.builtins.length > 0,
      "the walk found no built-in in a file that imports node:http — it cannot see them anywhere");
    assert.ok(server.builtins.some((edgeText) => edgeText.endsWith("-> node:http")));
  });

  test("it reaches src/node/", () => {
    assert.ok(server.files.some((file) => file.startsWith("src/node/")),
      "the walk found nothing under src/node/ in a file that imports lokalized/node");
  });

  test("both graphs share the view, which is what makes the rule bite", () => {
    // If the two examples had separate views, keeping Node out of the edge graph would be free.
    for (const shared of ["examples/app/render.js", "examples/app/cache-policy.js"]) {
      assert.ok(edge.files.includes(shared));
      assert.ok(server.files.includes(shared));
    }
  });
});
