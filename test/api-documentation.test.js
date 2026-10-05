/* Copyright 2026 Revetware LLC. Licensed under the Apache License, Version 2.0. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { editionFor, escapeHtml, prepareDeclarationInputs, publicEntryPoints, validateReleaseSource } from "../tools/api-documentation.mjs";

test("development source cannot be labelled as a tagged release", () => {
  assert.equal(editionFor(undefined, "1.0.0-rc.2"), "development");
  assert.equal(editionFor("1.0.0-rc.2", "1.0.0-rc.2"), "1.0.0-rc.2");
  assert.throws(() => editionFor("1.0.0", "1.0.0-rc.2"), /does not match/);
  assert.throws(() => validateReleaseSource("1.0.0", true, ["1.0.0"]), /clean checkout/);
  assert.throws(() => validateReleaseSource("1.0.0", false, ["1.0.1"]), /release tag/);
  assert.doesNotThrow(() => validateReleaseSource("1.0.0", false, ["v1.0.0"]));
});

test("edition names cannot escape their output directory or admit malformed versions", () => {
  for (const value of ["../outside", "v1.0.0", "01.0.0", "1.0", "1.0.0+build", "1.0.0-01", "1.0.0\n"])
    assert.throws(() => editionFor(value, value), /semantic version/, value);
});

test("the reference follows every actual consumer entry point", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const entries = publicEntryPoints(packageJson);
  assert.equal(entries.length, 9);
  assert.ok(entries.some((entry) => entry.name === "lokalized/node"));
  assert.ok(entries.some((entry) => entry.name === "lokalized/data/ranges"));
  assert.ok(entries.every((entry) => entry.path.endsWith(".d.ts")));
  assert.throws(() => publicEntryPoints({ name: "example", exports: { ".": { import: "./index.js" } } }), /Missing types/);
  assert.equal(packageJson.dependencies, undefined, "documentation tools must remain development dependencies");
});

test("edition labels are escaped in the generated hosting index", () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});

test("reference presentation retains the derived type and leaves consumer declarations untouched", () => {
  const scratch = mkdtempSync(join(tmpdir(), "lokalized-docs-inputs-"));
  try {
    const packageRoot = join(scratch, "package");
    mkdirSync(join(packageRoot, "types/core"), { recursive: true });
    mkdirSync(join(packageRoot, "Documentation"), { recursive: true });
    const original = "/** The immutable runtime. */\nexport type Strings = ReturnType<typeof createStrings>;\n";
    const shipped = join(packageRoot, "types/core/index.d.ts");
    writeFileSync(shipped, original);
    writeFileSync(join(packageRoot, "Documentation/SupportingTypes.d.ts"), "export type Supporting = string;\n");
    const snapshot = prepareDeclarationInputs(packageRoot, join(scratch, "output"));
    const copied = readFileSync(join(snapshot, "types/core/index.d.ts"), "utf8");
    assert.equal(readFileSync(shipped, "utf8"), original);
    assert.match(copied, /@interface/);
    assert.match(copied, /export type Strings = ReturnType<typeof createStrings>;/);
    writeFileSync(shipped, "export type Strings = { get: () => string };\n");
    assert.throws(() => prepareDeclarationInputs(packageRoot, join(scratch, "output")), /Cannot identify/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
