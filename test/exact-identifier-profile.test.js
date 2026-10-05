// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createStrings, RETURN_KEY } from "../src/core/index.js";
import { parseStrings, StringsParseError } from "../src/parse/index.js";

const bytes = readFileSync(new URL("./fixtures/exact-identifier-v1.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "3b20ec306ec5da919909e28a6db04085ad4cf9133d76adb6cf87f3631ee72e6f");
const profile = JSON.parse(bytes.toString("utf8"));
assert.equal(profile.profileID, "exact-identifier-v1");
assert.equal(profile.profileVersion, "1.0.0");
assert.equal(profile.cases.length, 15);

describe("shared exact Unicode identifier profile", () => {
  for (const row of profile.cases) {
    it(row.id, () => {
      const source = profile.fixture.catalogs[row.catalog];
      if (row.operation === "parse") {
        assert.equal(row.expected.status, "refused");
        assert.throws(() => parseStrings(source, { locale: profile.fixture.locale, source: row.id }), (error) => {
          assert.ok(error instanceof StringsParseError);
          assert.equal(error.message, row.expected.message);
          return true;
        });
        return;
      }
      const parsed = parseStrings(source, { locale: profile.fixture.locale, source: row.id });
      const strings = createStrings({
        fallbackLocale: profile.fixture.locale,
        localeSupplier: () => profile.fixture.locale,
        localizedStringSupplier: () => ({ [profile.fixture.locale]: parsed }),
        translationFailureHandler: () => RETURN_KEY,
      });
      const values = row.values ? Object.fromEntries(row.values.map((/** @type {any} */ value) => [value.name, value.text])) : undefined;
      const result = strings.getResult(row.key, values);
      assert.equal(result.status, row.expected.status);
      assert.equal(result.key, row.expected.key);
      assert.equal(result.translation, row.expected.translation);
      assert.deepEqual([...result.attemptedLocales], row.expected.attemptedLocales);
    });
  }
});
