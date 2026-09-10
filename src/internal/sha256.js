// @ts-check
/**
 * A small, synchronous SHA-256 — FIPS 180-4, over bytes, to lowercase hexadecimal.
 *
 * WHY THE PORT CARRIES ITS OWN. Plan section 6.1 requires `computeCatalogIdentity`,
 * `validateStringsManifest` and `parseStringsManifest` to be SYNCHRONOUS in a browser with no Node
 * APIs. WebCrypto's `crypto.subtle.digest` is asynchronous and cannot be awaited from a synchronous
 * function, and `node:crypto` is unavailable to `lokalized/load`, which is browser- and
 * edge-reachable. So the plan explicitly gives the load graph "a small audited synchronous SHA-256
 * implementation for this bounded identity projection". CATALOG BODIES ARE NOT HASHED HERE — those
 * go through the asynchronous WebCrypto capability, which is a different requirement in 6.2.
 *
 * "AUDITED" IS A CLAIM ABOUT EVIDENCE, so the evidence is named: `test/sha256.test.js` runs the four
 * NIST FIPS 180-4 example vectors (the empty string, "abc", the 56-byte two-block message, and the
 * one-million-'a' message that exercises the length encoding past 2^19 bits) plus a differential
 * against `node:crypto` over every input length from 0 to 200 bytes, which is where padding-boundary
 * mistakes live: at 55, 56, 63, 64 and 119 bytes a block either just fits its length field or does
 * not. A hand-written digest that is only spot-checked on "abc" passes while being wrong for exactly
 * those inputs.
 *
 * Numbers are kept in 32-bit unsigned lanes with `>>> 0` and `Math.imul`, never in doubles: `a + b`
 * on two values near 2^32 loses low bits once the sum exceeds 2^53 only in theory, but `a * b` does
 * so in practice, which is why the compression function multiplies through `Math.imul`.
 */

/** FIPS 180-4 section 4.2.2: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** @param {number} value @param {number} bits */
const rotr = (value, bits) => ((value >>> bits) | (value << (32 - bits))) >>> 0;

/**
 * @param {Uint8Array} bytes
 * @returns {string} the full lowercase hexadecimal digest
 */
export function sha256Hex(bytes) {
  // FIPS 180-4 section 5.1.1: append 0x80, then zeros, so that the length ends 8 bytes short of a
  // 64-byte multiple, then the message length in BITS as a big-endian 64-bit integer.
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // The high word is written from a float division rather than a shift: `bitLength << 32` is 0 in
  // JavaScript, and a message over 512 MiB would silently record a zero high word.
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  // Section 5.3.3: the first 32 bits of the fractional parts of the square roots of the first 8 primes.
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; ++i) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; ++i) {
      const a = /** @type {number} */ (w[i - 15]);
      const b = /** @type {number} */ (w[i - 2]);
      const s0 = (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = (/** @type {number} */ (w[i - 16]) + s0 + /** @type {number} */ (w[i - 7]) + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; ++i) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + /** @type {number} */ (K[i]) + /** @type {number} */ (w[i])) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  let hex = "";
  for (const word of [h0, h1, h2, h3, h4, h5, h6, h7]) hex += word.toString(16).padStart(8, "0");
  return hex;
}
