#!/usr/bin/env node
// @ts-check
/**
 * RUNS A COMMAND UNDER A PRIVATE TEMP FOLDER AND FAILS IF IT LEAVES ANYTHING THERE.
 *
 * MEASURED 2026-09-23: the system temp folder on the authoring machine held 48,128 `lokalized-*`
 * directories. Two causes, both invisible to every gate that existed:
 *
 *   - test files that `mkdtempSync` a fixture per call and never remove it. One green `npm test` left
 *     59 directories behind — 45 `lokalized-cause-*`, 7 `lokalized-clause73-*`, 4
 *     `lokalized-session-*`, 3 `lokalized-budget-*` — and 26,651 `lokalized-cause-*` had accumulated;
 *   - tools that remove their work directory in a `finally` around a `process.exit`. `process.exit`
 *     does not run `finally`, so `diff:language-range`, `diff:lookup`, `diff:direct-tag` and
 *     `diff:phonetic` leaked on EVERY run, and `diff:load` had no removal at all. It is the shape
 *     `lokalized-spec/tools/iana-oracle/build.mjs` had and fixed, and the class of M-D S16's 2.0 GB
 *     conformance leak.
 *
 * A leak is invisible where it happens, because the temp folder is shared with everything else on the
 * machine and nobody counts it. A PRIVATE folder that starts empty makes it countable: whatever is in
 * it when the command ends, the command left there. So this sets `TMPDIR` (and `TMP`/`TEMP`, which
 * `os.tmpdir()` also reads) to a fresh directory, runs the command, and FAILS if any entry remains —
 * except the names in `FOREIGN_ENTRIES`, which the runtime creates, reuses across runs, and are not
 * this repository's to remove. The private folder itself is removed on every exit this process can
 * observe: the command finishing, failing or dying, and any of `FORWARDED_SIGNALS` sent to this
 * wrapper, which it passes to the command and then outlives. A signal OUTSIDE that list whose default
 * action terminates still ends this process past the removal and leaves the command running without
 * it: SIGKILL, which cannot be caught, and — measured by a review — SIGUSR2 and SIGALRM, which nothing
 * sends a test run in practice.
 *
 * TWO ANTI-VACUITY TERMS, because "nothing was left" is also what a run that never reached the
 * private folder reports. Before the command runs, a child Node is asked for `os.tmpdir()` under the
 * same environment and must answer the private folder, or the run fails: that is the mechanism every
 * Node process the command starts relies on. And the run REPORTS how many entries it saw created
 * there (an `fs.watch`, names outside `FOREIGN_ENTRIES`), so a suite that stops using the folder
 * shows `0` rather than a bare "clean". The count is reported, not gated: `npm test -- one.test.js`
 * may legitimately touch no temp folder at all. It is a LOWER BOUND read after a short settle,
 * because macOS delivers these events late — measured, a child that created three directories and
 * exited had one reported at its exit and all three 100 ms later, which is the settle used here
 * (it runs after every wrapped command, so it is kept to what was measured).
 * `test/temp-hygiene.test.js` proves the gate fires.
 *
 * WHERE IT RUNS: every step of `npm run verify` is wrapped in `package.json`, `npm test` included, so
 * CI (which runs the same steps by the same names) is held to it too. `test/temp-hygiene.test.js`
 * derives the step list from `verify` and fails on a step that is not wrapped. The differentials are
 * deliberately NOT wrapped: `npm run diff:all` gives each its own private folder and records what it
 * left, and a wrapper would empty that folder before the count was taken.
 *
 *   node tools/temp-hygiene.mjs <command> [args…]          e.g. node tools/temp-hygiene.mjs node --test
 *
 * The command's own exit status wins: a failing command exits with its status, and leftovers are
 * reported beside it rather than masking it. A clean command that leaves an entry exits 1.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync, watch } from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Entries a run may leave that are not a leak, each with the reason. A name here is excused
 * wherever it appears, so it must never be one of this repository's own prefixes: that is refused
 * below rather than trusted to review.
 */
export const FOREIGN_ENTRIES = new Map([
  ["node-compile-cache",
    "Node's module compile cache, which TypeScript's `tsc` switches on (`module.enableCompileCache`). " +
    "The runtime creates it under the temp folder and REUSES it across runs, so it is one directory " +
    "per machine, not one per run, and it is not this repository's to remove."],
]);
for (const name of FOREIGN_ENTRIES.keys())
  if (name.startsWith("lokalized-"))
    throw new Error(`FOREIGN_ENTRIES names '${name}', which is this repository's own prefix and can never be excused`);

/** Signals this wrapper forwards to the command before exiting through its own removal of the folder. */
export const FORWARDED_SIGNALS = /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]);

/** A fresh private temp folder, removed when this process exits by any route it can observe. */
export function privateTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "lokalized-temp-hygiene-"));
  process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** The environment that points `os.tmpdir()` in a child at `directory`. */
export const temporaryEnvironment = (/** @type {string} */ directory) =>
  ({ ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory });

/** What a run left behind: every entry except the declared foreign ones, sorted. */
export const leftoversIn = (/** @type {string} */ directory) =>
  readdirSync(directory).filter((name) => !FOREIGN_ENTRIES.has(name)).sort();

/**
 * Whether this file is the entry point, compared by REAL path. Node gives `argv[1]` as typed and
 * `import.meta.url` resolved, so a start through a symlinked path (`/tmp` and `/var` are symlinks on
 * macOS) compared unequal and the wrapper silently ran nothing and exited 0 — measured, a command
 * exiting 3 read as 0. An import from elsewhere has no such `argv[1]` and is not the entry point.
 */
const isEntryPoint = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  const [command, ...commandArgs] = process.argv.slice(2);
  if (!command) {
    console.error("usage: node tools/temp-hygiene.mjs <command> [args…]");
    process.exit(2);
  }

  const directory = privateTemporaryDirectory();
  // Registered BEFORE anything that takes time, so a signal arriving during the check below is held
  // until it returns rather than killing this process past its folder removal.
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  for (const signal of FORWARDED_SIGNALS)
    process.on(signal, () => (child ? child.kill(signal) : process.exit(128 + constants.signals[signal])));

  const answered = spawnSync(process.execPath, ["-e", "process.stdout.write(require('node:os').tmpdir())"],
    { encoding: "utf8", env: temporaryEnvironment(directory) }).stdout;
  const resolved = (/** @type {string} */ path) => { try { return realpathSync(path); } catch { return null; } };
  if (!answered || resolved(answered) !== resolved(directory)) {
    console.error(`temp hygiene: a child Node given this environment answers os.tmpdir() = ${JSON.stringify(answered)}, ` +
      `not the private folder ${directory}, so nothing this run could count would be evidence`);
    process.exit(2);
  }
  /** @type {Set<string>} */
  const created = new Set();
  // FSEvents also reports the watched folder's own creation, which is not the command's.
  const watcher = watch(directory, (_event, name) => {
    if (name && name !== basename(directory) && !FOREIGN_ENTRIES.has(String(name))) created.add(String(name));
  });

  // A signal sent to this wrapper alone is forwarded (the handlers above), so it still stops the
  // command and the folder is still removed; a terminal's Ctrl-C reaches both, and the command's own
  // handling wins.
  child = spawn(command, commandArgs, { stdio: "inherit", env: temporaryEnvironment(directory) });

  child.on("error", (error) => {
    console.error(`temp hygiene: could not run ${command}: ${error.message}`);
    process.exit(2);
  });
  child.on("exit", (code, signal) => setTimeout(() => {
    watcher.close();
    const left = leftoversIn(directory);
    const status = code ?? 128 + (signal ? constants.signals[signal] : 0);
    if (left.length > 0) {
      console.error(`\ntemp hygiene: \`${[command, ...commandArgs].join(" ")}\` left ${left.length} ` +
        `entr${left.length === 1 ? "y" : "ies"} in its private temp folder:\n  ${left.slice(0, 20).join("\n  ")}` +
        `${left.length > 20 ? "\n  …" : ""}\nWhatever made ${left.length === 1 ? "it" : "them"} must remove what it ` +
        "creates: an `after`/`t.after` hook in a test, a `process.on(\"exit\")` removal in a tool (a `finally` " +
        "around `process.exit` never runs).");
      process.exit(status !== 0 ? status : 1);
    }
    console.log(`temp hygiene: ${created.size} temp entr${created.size === 1 ? "y" : "ies"} created, none left behind`);
    process.exit(status);
  }, 100));
}
