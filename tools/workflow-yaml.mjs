// @ts-check
/**
 * A STRUCTURAL READER FOR THE WORKFLOW SUBSET THIS REPOSITORY WRITES — and, more importantly, one
 * that THROWS on a spelling it does not understand instead of returning a plausible answer.
 *
 * **WHY THIS EXISTS.** `test/publish-workflow.test.js` was line-oriented, and a 62-agent review
 * measured what that costs. Every permission rule was anchored at two spaces of indent, i.e. the
 * WORKFLOW-level block — so a job-level `permissions:` block, which REPLACES the workflow-level set
 * for that job, was invisible to all five of them. The trigger rule was a DENYLIST of four event
 * names, so `workflow_call:`, `release:` and the inline sequence form `on: [push]` all passed. The
 * "verify runs before publish" rule compared `indexOf` positions in the file INCLUDING comments, and
 * the first occurrence of `npm run verify` was a comment. And the helper that collected `run:` bodies
 * matched `/^\s*run: /`, which cannot match `      - run: npm ci` — the dash sits between the
 * whitespace and the key — so the rule forbidding raw `${{ inputs.* }}` in a shell never examined a
 * one-line step at all.
 *
 * None of those failed loudly. They returned green. That is the `graph-walk.mjs` lesson one file
 * over: when you point a text matcher at a structured input, the question is not "does it work" but
 * "what does it do when it cannot parse this", and the honest answer is usually that nobody asked.
 *
 * **THE CONTRACT.** This parses the subset the two workflows here use: block mappings, block
 * sequences, flow sequences as values, and block scalars. It REFUSES tabs, anchors, aliases, merge
 * keys, nested inline sequences and any line it cannot classify — a refusal is a loud failure that
 * someone fixes, where a silent miss is a gate that has stopped gating. It does NOT validate YAML;
 * GitHub is the first thing that truly parses these files. It exists so the assertions above it are
 * about structure rather than about substrings.
 */

/**
 * @typedef {object} Node
 * @property {string|null} key       map key, or null for a bare sequence-item scalar
 * @property {string|null} value     inline scalar value, if any
 * @property {string[]|null} flow    flow-sequence members, if the value was `[a, b]`
 * @property {string|null} block     block-scalar body, if the value was `|` / `>` (and variants)
 * @property {Node[]} children       nested map entries or sequence items
 * @property {boolean} seq           true when this node is a sequence ITEM
 * @property {number} line           1-based line number
 */

const BLOCK_SCALAR = /^[|>][+-]?\d*$|^[|>]\d*[+-]?$/;

/**
 * A trailing comment, removed the way YAML removes it — and GitHub with it.
 *
 * **WHY THE READER NEEDS THIS.** The standard way to pin an action is
 * `uses: actions/checkout@<sha> # v4.4.0`, the comment being what a reviewer (and Dependabot) reads.
 * Without this the reader returned `actions/checkout@<sha> # v4.4.0` as the VALUE, so a rule
 * requiring a bare 40-hex SHA would have refused every correctly pinned line, and a rule comparing
 * a permission value would have compared the comment. Measured before it landed: no value in either
 * workflow carried one, and both parse trees are byte-identical across the change.
 *
 * In a PLAIN scalar, `#` begins a comment when whitespace precedes it — including inside what
 * looks like shell quoting in a one-line `run:`, which GitHub truncates there too. A QUOTED scalar
 * keeps its `#`; a comment after the closing quote is removed. A quoted value this cannot delimit
 * (an escaped quote followed by a comment) is REFUSED rather than guessed at.
 *
 * @param {string} value @param {(why: string) => never} refuse @returns {string|null}
 */
function withoutComment(value, refuse) {
  if (value.startsWith("#")) return null;
  if (/^["']/.test(value)) {
    const whole = /^("[^"\\]*"|'[^']*')(\s+#.*)?$/.exec(value);
    if (whole) return whole[1];
    if (/\s#/.test(value)) refuse("comment after a quoted value this reader cannot delimit");
    return value;
  }
  const at = /\s#/.exec(value);
  return at ? value.slice(0, at.index).trimEnd() : value;
}

/** @param {string} text @param {string} what @returns {Node} the synthetic document root */
export function parseWorkflow(text, what = "workflow") {
  const raw = text.split("\n");
  const refuse = (i, why) => {
    throw new Error(`${what}:${i + 1} cannot be parsed structurally (${why}): ${JSON.stringify(raw[i])}\n` +
      "This reader refuses what it does not understand, because a reader that guesses is a gate that " +
      "has stopped gating. Either write the construct in the supported subset or teach the reader.");
  };

  /** @type {Node} */
  const root = { key: null, value: null, flow: null, block: null, children: [], seq: false, line: 0 };
  /** @type {{indent: number, node: Node}[]} */
  const stack = [{ indent: -1, node: root }];

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (line.includes("\t")) refuse(i, "tab character");
    if (line.trim() === "" || /^\s*#/.test(line)) continue;

    let indent = line.length - line.trimStart().length;
    let rest = line.slice(indent);
    let seq = false;

    if (rest === "-" || rest.startsWith("- ")) {
      seq = true;
      rest = rest === "-" ? "" : rest.slice(2);
      indent += 2;
      if (rest.startsWith("- ")) refuse(i, "nested inline sequence item");
      if (rest === "") refuse(i, "sequence item with nothing on its line");
    }
    if (/^[&*]/.test(rest) || /^<<:/.test(rest)) refuse(i, "anchor, alias or merge key");

    const m = /^(.*?):(?:\s+(.*))?$/.exec(rest);
    /** @type {Node} */
    let node;
    // A key with a space in it is almost always a line this reader has misread — a bare sentence, a
    // shell fragment that escaped its block scalar. Refuse rather than invent a mapping entry.
    if (m && /\s/.test(m[1]) && !/^["']/.test(m[1])) refuse(i, "mapping key contains whitespace");
    if (m) {
      const key = m[1].replace(/^["']|["']$/g, "");
      const value = m[2] === undefined ? null : withoutComment(m[2], (why) => refuse(i, why));
      node = { key, value, flow: null, block: null, children: [], seq, line: i + 1 };
      if (value !== null && /^[&*]/.test(value)) refuse(i, "anchor or alias value");
      if (value !== null && BLOCK_SCALAR.test(value)) {
        // Capture the body verbatim. It is shell, not YAML, and must never be re-parsed as YAML.
        const body = [];
        let j = i + 1;
        for (; j < raw.length; j++) {
          const b = raw[j];
          if (b.trim() === "") { body.push(""); continue; }
          if (b.length - b.trimStart().length <= indent) break;
          body.push(b);
        }
        while (body.length > 0 && body[body.length - 1] === "") body.pop();
        node.block = body.join("\n");
        node.value = null;
        i = j - 1;
      } else if (value !== null && value.startsWith("[")) {
        if (!value.endsWith("]")) refuse(i, "flow sequence spanning lines");
        node.flow = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter((s) => s !== "");
        node.value = null;
      }
    } else if (seq) {
      node = { key: null, value: withoutComment(rest, (why) => refuse(i, why)), flow: null, block: null, children: [], seq, line: i + 1 };
    } else {
      return refuse(i, "not a mapping entry and not a sequence item");
    }

    // A sequence ITEM must also pop the container of the PREVIOUS item, which sits half a level
    // above the item's own keys. Without this every later item nests inside the first one, and a
    // job reports exactly one step — which is what the first run of this reader did.
    const popTo = seq ? indent - 1 : indent;
    while (stack.length > 1 && popTo <= stack[stack.length - 1].indent) stack.pop();

    if (seq && node.key !== null) {
      // A sequence item whose content is a MAP gets its own container, so that every key of the item
      // is a CHILD of the item rather than the first key BEING the item. Without this, `- name: X`
      // followed by `run: …` reads as a node keyed `name` with a `run` child, and asking a step for
      // its `name` finds nothing — which is exactly the shape that made the first run of this reader
      // report every step as `run: |`.
      const container = { key: null, value: null, flow: null, block: null, children: [], seq: true, line: i + 1 };
      stack[stack.length - 1].node.children.push(container);
      stack.push({ indent: indent - 1, node: container });
      node.seq = false;
      container.children.push(node);
      stack.push({ indent, node });
      continue;
    }

    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }
  return root;
}

/** The direct child with this key, or undefined. @param {Node|undefined} node @param {string} key */
export const child = (node, key) => node?.children.find((c) => c.key === key && !c.seq);

/** Walk a key path. @param {Node} node @param {...string} path */
export function at(node, ...path) {
  let cur = /** @type {Node|undefined} */ (node);
  for (const k of path) cur = child(cur, k);
  return cur;
}

/** Sequence items directly under a node. @param {Node|undefined} node */
export const items = (node) => (node?.children ?? []).filter((c) => c.seq);

/** Direct mapping keys under a node. @param {Node|undefined} node */
export const keys = (node) => (node?.children ?? []).filter((c) => !c.seq && c.key).map((c) => /** @type {string} */ (c.key));

/**
 * Every `run:` body in the tree, block or inline, with its line number.
 * @param {Node} node @returns {{line: number, body: string}[]}
 */
export function runBodies(node) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.key === "run") out.push({ line: c.line, body: c.block ?? c.value ?? "" });
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Every step (sequence item under a job's `steps:`) of a named job. @param {Node} root @param {string} job */
export const stepsOf = (root, job) => items(at(root, "jobs", job, "steps"));

/**
 * The permission set a job actually runs with: its own block if it has one, otherwise the
 * workflow-level block. A job-level `permissions:` REPLACES the workflow-level set — it does not
 * merge with it — which is the fact the previous gate's two-space anchors could not see.
 * @param {Node} root @param {string} job
 */
export function effectivePermissions(root, job) {
  const own = at(root, "jobs", job, "permissions");
  const block = own ?? child(root, "permissions");
  if (!block) return null;
  const out = /** @type {Record<string, string>} */ ({});
  for (const c of block.children) if (c.key) out[c.key] = c.value ?? "";
  return { scope: own ? "job" : "workflow", permissions: out };
}

/** The event names in `on:`, however it is spelled — block map, flow sequence, or bare scalar. @param {Node} root */
export function triggers(root) {
  const on = child(root, "on");
  if (!on) return [];
  if (on.flow) return on.flow;
  if (on.value) return [on.value];
  return keys(on);
}
