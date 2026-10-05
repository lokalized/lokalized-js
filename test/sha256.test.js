// @ts-check
/**
 * The port's own synchronous SHA-256, checked the way "audited" has to mean something.
 *
 * The plan gives `lokalized/load` a hand-written digest because `computeCatalogIdentity` must be
 * synchronous in a browser and WebCrypto's is not. A hand-written digest is exactly the kind of code
 * that passes a spot check on "abc" and is wrong at a padding boundary, so this file checks both
 * ends: the FIPS 180-4 example vectors, and a differential against `node:crypto` over every length
 * where the padding decision changes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();

test("the FIPS 180-4 example vectors", () => {
  assert.equal(sha256Hex(utf8.encode("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex(utf8.encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  // 56 bytes: the message that needs a SECOND block purely for its length field.
  assert.equal(sha256Hex(utf8.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  // One million 'a': 8,000,000 bits, which exercises a length that does not fit in the low 32 bits
  // of the count on the way to being written as a 64-bit big-endian field.
  assert.equal(sha256Hex(new Uint8Array(1_000_000).fill(0x61)),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});

test("agrees with node:crypto at every length from 0 to 200 bytes", () => {
  // The range is chosen for its BOUNDARIES rather than its size: at 55 and 56 bytes the length field
  // just fits or just does not, and 63/64 and 119/120 are the same decision one and two blocks on.
  // A digest that mishandles padding is correct on almost every other length.
  const mismatched = [];
  for (let length = 0; length <= 200; ++length) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; ++i) bytes[i] = (i * 37 + 11) & 0xff;
    if (sha256Hex(bytes) !== createHash("sha256").update(Buffer.from(bytes)).digest("hex"))
      mismatched.push(length);
  }
  assert.deepEqual(mismatched, []);
});

test("the digest is lowercase hexadecimal, always 64 characters", () => {
  for (const length of [0, 1, 64, 65]) {
    const digest = sha256Hex(new Uint8Array(length).fill(0xff));
    assert.match(digest, /^[0-9a-f]{64}$/, `length ${length} produced ${digest}`);
  }
});
