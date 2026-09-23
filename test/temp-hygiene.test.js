// @ts-check
/**
 * `tools/temp-hygiene.mjs`, the gate every `npm run verify` step runs under, seen failing.
 *
 * The gate exists because 48,128 `lokalized-*` directories had piled up in this machine's temp folder
 * with every gate green (measured 2026-09-23): tests that never removed their fixtures, and tools that
 * removed their work directory in a `finally` around `process.exit`, which never runs. A gate nothing
 * has seen fail is a claim, so each arm below runs a small command under it and checks the verdict —
 * including that exact `finally` shape, beside the `exit` hook that replaced it.
 *
 * Every run gets its own OUTER temp folder, and every arm that runs the gate also asserts what is left
 * in it: the gate makes its private folder inside whatever temp folder it was given, and must remove
 * it on every path, the failing and interrupted ones included.
 *
 * The exit status is the other half, and it is not a detail: `npm test` exits with whatever status
 * the gate chooses, so the gate decides whether CI goes red when a test fails. An independent review
 * found that NO arm here reached the gate's final `process.exit(status)` — every failing arm also
 * leaked and left through the leak branch — so that line replaced by `process.exit(0)` kept this file
 * green, and CI's unit-test step then read a failing suite as green. `fails-clean` is that arm.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(root, "tools/temp-hygiene.mjs");

const scratch = mkdtempSync(join(tmpdir(), "lokalized-temp-hygiene-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A CommonJS expression that makes a directory named `<prefix>XXXXXX` in the temp folder. */
const make = (/** @type {string} */ prefix) =>
  `require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), ${JSON.stringify(prefix)}))`;
const remove = (/** @type {string} */ binding) => `require("node:fs").rmSync(${binding}, { recursive: true, force: true })`;

/** The environment that points `os.tmpdir()` at `outer`. */
const inside = (/** @type {string} */ outer) => ({ ...process.env, TMPDIR: outer, TMP: outer, TEMP: outer });

/** Run `node -e source` under the gate (started as `gate`), inside a fresh outer temp folder named for the arm. */
function underGate(/** @type {string} */ arm, /** @type {string} */ source, gate = GATE) {
  const outer = join(scratch, arm);
  mkdirSync(outer);
  const run = spawnSync(process.execPath, [gate, process.execPath, "-e", source], { encoding: "utf8", env: inside(outer) });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, outerLeft: readdirSync(outer) };
}

test("a command that removes what it creates passes", () => {
  const run = underGate("clean", `${remove(make("lokalized-probe-"))};`);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /none left behind/);
  assert.deepEqual(run.outerLeft, []);
});

test("a command that leaves a directory FAILS, naming it — and the gate's own folder is still removed", () => {
  const run = underGate("leak", `${make("lokalized-probe-")};`);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /left 1 entry in its private temp folder:\n {2}lokalized-probe-\w{6}\n/);
  assert.deepEqual(run.outerLeft, []);
});

test("a leak under ANY name fails, not only under this repository's prefix", () => {
  const run = underGate("foreign-prefix", `${make("someone-else-")};`);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /someone-else-\w{6}/);
  assert.deepEqual(run.outerLeft, []);
});

test("a command that FAILS and leaves nothing keeps its own status — the gate decides whether CI goes red", () => {
  const run = underGate("fails-clean", "process.exit(3);");
  assert.equal(run.status, 3, "a failing run must not read as green because it cleaned up after itself");
  assert.match(run.stdout, /none left behind/);
  assert.deepEqual(run.outerLeft, []);
});

test("a command killed by a signal exits 128 plus the signal's number, as a shell reports it", () => {
  const run = underGate("killed", 'process.kill(process.pid, "SIGTERM");');
  assert.equal(run.status, 128 + constants.signals.SIGTERM);
  assert.deepEqual(run.outerLeft, []);
});

test("the command's own failing status wins, and the leak is reported beside it", () => {
  const run = underGate("fails-and-leaks", `${make("lokalized-probe-")}; process.exit(3);`);
  assert.equal(run.status, 3, "a leak must not mask the command's own failure");
  assert.match(run.stderr, /lokalized-probe-\w{6}/);
  assert.deepEqual(run.outerLeft, []);
});

test("THE SHAPE THE DIFFERENTIALS HAD: a `finally` around `process.exit` leaks, an `exit` hook does not", () => {
  const inFinally = underGate("finally",
    `const work = ${make("lokalized-work-")}; try { process.exit(0); } finally { ${remove("work")}; }`);
  assert.equal(inFinally.status, 1, "process.exit skips finally, so this must be caught as a leak");
  assert.match(inFinally.stderr, /lokalized-work-\w{6}/);

  const onExit = underGate("exit-hook",
    `const work = ${make("lokalized-work-")}; process.on("exit", () => ${remove("work")}); try { process.exit(0); } finally {}`);
  assert.equal(onExit.status, 0, onExit.stderr);
  assert.deepEqual([...inFinally.outerLeft, ...onExit.outerLeft], []);
});

test("the runtime's compile cache is excused, and nothing else is", () => {
  const cache = `require("node:fs").mkdirSync(require("node:path").join(require("node:os").tmpdir(), "node-compile-cache"))`;
  const excused = underGate("compile-cache", `${cache};`);
  assert.equal(excused.status, 0, excused.stderr);
  assert.deepEqual(excused.outerLeft, []);

  const beside = underGate("compile-cache-and-leak", `${cache}; ${make("lokalized-probe-")};`);
  assert.equal(beside.status, 1);
  // The listed entries, not the whole message: the message echoes the command, which names the cache.
  assert.match(beside.stderr, /left 1 entry in its private temp folder:\n {2}lokalized-probe-\w{6}\n/,
    "the excused entry must not be listed or counted as a leak");
  assert.deepEqual(beside.outerLeft, []);
});

test("the self-check stops the run, with 2, when a Node child does not see the private folder", () => {
  // A preload that moves every Node process's os.tmpdir() one level below where it was pointed: the
  // shape of a command resolving its temp folder some other way, which would make "nothing left" true
  // of a folder nothing used. The gate must refuse before running the command at all.
  const preload = join(scratch, "tmpdir-elsewhere.cjs");
  writeFileSync(preload, 'const os = require("node:os"); const real = os.tmpdir;\n' +
    'os.tmpdir = () => require("node:path").join(real(), "elsewhere");\n');
  const outer = join(scratch, "self-check");
  mkdirSync(join(outer, "elsewhere"), { recursive: true });
  const ran = join(scratch, "self-check-ran");
  const run = spawnSync(process.execPath, [GATE, process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "")`], {
    encoding: "utf8",
    env: { ...inside(outer), NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(preload)}` },
  });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /not the private folder/);
  assert.equal(existsSync(ran), false, "the command ran although the gate could not have seen what it left");
  // The gate's own folder is gone from wherever the preload let it land.
  assert.deepEqual([readdirSync(outer), readdirSync(join(outer, "elsewhere"))], [["elsewhere"], []]);
});

test("started through a symlinked path it still runs and still gates the command", () => {
  // `/tmp` and `/var` are symlinks on macOS. Compared as typed, such a start was not recognised as the
  // entry point, and the gate ran nothing and exited 0 — measured, a command exiting 3 read as 0.
  const linked = join(scratch, "linked-temp-hygiene.mjs");
  symlinkSync(GATE, linked);
  const run = underGate("symlinked", "process.exit(3);", linked);
  assert.equal(run.status, 3);
  assert.match(run.stdout, /none left behind/);
  assert.deepEqual(run.outerLeft, []);
});

/** Poll until `predicate` holds, failing with `what` after ten seconds. */
async function until(/** @type {() => boolean} */ predicate, /** @type {string} */ what) {
  for (let waited = 0; !predicate(); waited += 20) {
    assert.ok(waited < 10000, what);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

/** Start the gate over `node -e source` WITHOUT waiting, and a promise for how it ended. */
function startGate(/** @type {string} */ outer, /** @type {string} */ source, /** @type {string} */ nodeOptions = "") {
  const gate = spawn(process.execPath, [GATE, process.execPath, "-e", source], {
    env: { ...inside(outer), NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} ${nodeOptions}` },
    stdio: "ignore",
  });
  /** @type {Promise<{ code: number | null, killedBy: string | null }>} */
  const exited = new Promise((resolveExit) => gate.on("exit", (code, killedBy) => resolveExit({ code, killedBy })));
  return { gate, exited };
}

// Listed HERE, not imported from the gate: a signal dropped from the gate's list must red its arm, not
// silently take the arm with it.
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]))
  test(`${signal} sent to the gate alone reaches the command, and the private folder is still removed`, async () => {
    // THE COMMAND CATCHES THE SIGNAL AND EXITS WITH ITS OWN CODE, 42, after a pause — and that code is
    // the discriminator. A gate that waits for its command can only report 42. A gate that exits ahead
    // of it reports 128+n of its own making, whether it forwarded first (a third review: when the
    // command re-raised the SAME signal at once, that gate matched every check on an idle machine and
    // failed only under load) or did not forward at all (the second review: the command ran on with no
    // parent). Neither outcome depends on timing. The received signal and the command being gone are
    // checked as well, so each failure names what went wrong.
    const OWN_EXIT = 42;
    const outer = join(scratch, `signal-${signal}`);
    mkdirSync(outer);
    const pidFile = join(scratch, `signal-${signal}-pid`);
    const received = join(scratch, `signal-${signal}-received`);
    const name = JSON.stringify(signal);
    // The pid is written under another name and renamed into place, so the file never exists EMPTY:
    // an empty pid reads as 0, and `process.kill(0, …)` signals this whole process group — the test
    // runner included.
    const { gate, exited } = startGate(outer, [
      'const fs = require("node:fs");',
      `process.on(${name}, () => { fs.writeFileSync(${JSON.stringify(received)}, ${name});`,
      `  setTimeout(() => process.exit(${OWN_EXIT}), 200); });`,
      `fs.writeFileSync(${JSON.stringify(`${pidFile}.partial`)}, String(process.pid));`,
      `fs.renameSync(${JSON.stringify(`${pidFile}.partial`)}, ${JSON.stringify(pidFile)});`,
      "setTimeout(() => {}, 30000);",
    ].join("\n"));
    let pid = 0;
    let gone = false;
    try {
      await until(() => existsSync(pidFile), "the command never started");
      pid = Number(readFileSync(pidFile, "utf8"));
      assert.ok(Number.isInteger(pid) && pid > 0, `the command recorded pid ${JSON.stringify(readFileSync(pidFile, "utf8"))}`);
      gate.kill(signal);
      const ended = await exited;
      assert.notDeepEqual(ended, { code: 128 + constants.signals[signal], killedBy: null },
        `the gate exited with ${128 + constants.signals[signal]} of its own making, ahead of its command`);
      assert.deepEqual(ended, { code: OWN_EXIT, killedBy: null }, "the gate must wait for its command and exit with its status");
      assert.equal(existsSync(received) ? readFileSync(received, "utf8") : null, signal,
        "the command never received the signal");
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "the command outlived the gate");
      gone = true;
      assert.deepEqual(readdirSync(outer), []);
    } finally {
      // Only a command this arm did NOT see exit, and only a real pid.
      if (!gone && Number.isInteger(pid) && pid > 0) try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
  });

test("a signal that arrives DURING the self-check is held, not fatal: the folder is still removed", async () => {
  // The gate registers its handlers before the self-check. In the older order — after the command was
  // spawned — a signal in that window killed the gate by its default action past its folder removal (a
  // review measured the folder left in the real temp folder), and the arms above stay green because
  // each waits for the command to start. A preload here holds ONLY the self-check's Node child, which
  // is the one whose `-e` script asks for `os.tmpdir()` that way, until the signal has been sent.
  const outer = join(scratch, "signal-during-self-check");
  mkdirSync(outer);
  const holding = join(scratch, "self-check-holding");
  const release = join(scratch, "self-check-release");
  const preload = join(scratch, "hold-self-check.cjs");
  writeFileSync(preload, [
    'const fs = require("node:fs");',
    `if (process.execArgv.some((argument) => argument.includes("require('node:os').tmpdir()"))) {`,
    `  fs.writeFileSync(${JSON.stringify(holding)}, "");`,
    "  const cell = new Int32Array(new SharedArrayBuffer(4));",
    `  for (let waited = 0; !fs.existsSync(${JSON.stringify(release)}) && waited < 10000; waited += 20)`,
    "    Atomics.wait(cell, 0, 0, 20);",
    "}",
    "",
  ].join("\n"));
  const { gate, exited } = startGate(outer, "setTimeout(() => {}, 30000);", `--require ${JSON.stringify(preload)}`);
  try {
    await until(() => existsSync(holding), "the self-check never started");
    gate.kill("SIGTERM");
  } finally {
    writeFileSync(release, "");
  }
  assert.deepEqual(await exited, { code: 128 + constants.signals.SIGTERM, killedBy: null },
    "a signal during the self-check killed the gate instead of being held and forwarded");
  assert.deepEqual(readdirSync(outer), []);
});

const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
const WRAPPED = "node tools/temp-hygiene.mjs ";

test("EVERY step `npm run verify` runs is under the gate, so each is held to it in verify and in CI", () => {
  // DERIVED from `verify` rather than listed here, so a step added to it tomorrow is covered or reds
  // this test — a hand-kept list of gated steps is the rot this gate exists to stop. CI runs the same
  // steps by the same `npm run` names (`test/verify-ci-parity.test.js`), so it inherits the wrapper.
  const steps = scripts.verify.split("&&").map((part) => part.trim())
    .map((part) => (part === "npm test" ? "test" : /^npm run ([\w:-]+)$/.exec(part)?.[1] ?? part));
  assert.ok(steps.length >= 29, `verify parsed into ${steps.length} step(s); the parse is broken or verify shrank`);
  const unwrapped = steps.flatMap((step) => (scripts[step] ?? `<no script named ${step}>`).split("&&")
    .map((command) => command.trim())
    .filter((command) => !command.startsWith(WRAPPED))
    .map((command) => `${step}: ${command}`));
  assert.deepEqual(unwrapped, [], "every command a verify step runs must start with `node tools/temp-hygiene.mjs`");
});

test("the differentials are NOT under it: `diff:all` gives each its own temp folder and records what it left", () => {
  // Wrapped, a differential would have its leftovers removed before `diff:all` counted them, and the
  // recorded `temporaryEntriesLeft` would read 0 whatever the tool did.
  const differentials = Object.entries(scripts).filter(([, body]) => /\btools\/[\w-]+-diff\/run\.mjs$/.test(body));
  assert.ok(differentials.length >= 9, `found ${differentials.length} differential script(s)`);
  assert.deepEqual(differentials.filter(([, body]) => body.includes("temp-hygiene")).map(([name]) => name), []);
});
