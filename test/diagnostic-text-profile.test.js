// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parseStrings } from "../src/parse/index.js";
import { parseStringsManifest } from "../src/load/manifest.js";
import { appendBoundedPathPart, boundedDiagnosticValue } from "../src/internal/json-parse.js";

const bytes = readFileSync(new URL("./fixtures/diagnostic-text-v1.1.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "1394c9136089b2b343f562f4ff7ade8d209f7b049b784fe1cc02eb041045c2a2");
const profile = JSON.parse(bytes.toString("utf8"));
for (const row of profile.cases) {
  test(row.id, () => {
    assert.throws(() => row.door === "catalog"
      ? parseStrings(row.document, { locale: "en", source: row.source })
      : parseStringsManifest(row.document, { source: row.source }), (error) => {
        assert.ok(error instanceof Error && error.name === "StringsParseError");
        assert.equal(error.message, row.expected.message);
        assert.equal(/** @type {any} */ (error).path, row.door === "catalog" ? row.expected.path : null);
        assert.ok(error.message.isWellFormed());
        assert.ok(row.expected.path.length <= 4096);
        return true;
      });
  });
}
test("diagnostic truncation retains complete pairs and the terminal path cap", () => {
  assert.equal(boundedDiagnosticValue("a".repeat(254) + "\ud800xy"), "a".repeat(254) + "\ud800…");
  assert.equal(boundedDiagnosticValue("a".repeat(254) + "😀x"), "a".repeat(254) + "�…");
  const path = appendBoundedPathPart("$.", "a".repeat(4092) + "😀x");
  assert.equal(path.length, 4096);
  assert.equal(appendBoundedPathPart(path, ".child"), path);
  assert.equal(boundedDiagnosticValue("a".repeat(253) + "😀x"), "a".repeat(253) + "😀x");
});
