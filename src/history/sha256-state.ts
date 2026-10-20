/** Standard SHA-256 (FIPS 180-4), with an explicit private cold-resume state.
 * Not a hash of chunk hashes; no OpenSSL state or execution authority. */
import { LIMITS } from "../service-contract.ts";
import {
  closed,
  integer,
  invalid,
  list,
  literal,
  text,
} from "../worker-public.mjs";

const IV = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export interface Sha256State {
  schema: "sha256/1";
  words: number[];
  /** All input bytes, including pending; compression has processed bytes - bytes%64. */
  bytes: number;
  pending: string;
}
export function decodeSha256State(value: unknown): Sha256State {
  const o = closed(value, ["schema", "words", "bytes", "pending"]);
  const words = list(o.words, 8, (v) => integer(v, 0, 0xffffffff));
  const bytes = integer(o.bytes, 0, LIMITS.segmentBytes),
    pending = text(o.pending, 84);
  const tail = Buffer.from(pending, "base64url");
  if (
    words.length !== 8 ||
    tail.length !== bytes % 64 ||
    tail.length > 63 ||
    tail.toString("base64url") !== pending ||
    (bytes < 64 && words.some((word, i) => word !== IV[i]))
  )
    invalid();
  return { schema: literal(o.schema, "sha256/1"), words, bytes, pending };
}
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
export class ResumableSha256 {
  private words = Uint32Array.from(IV);
  private count = 0;
  private pending = Buffer.alloc(0);
  private readonly schedule = new Uint32Array(64);
  constructor(value?: Sha256State) {
    if (value) {
      const state = decodeSha256State(value);
      this.words.set(state.words);
      this.count = state.bytes;
      this.pending = Buffer.from(state.pending, "base64url");
    }
  }
  snapshot(): Sha256State {
    return {
      schema: "sha256/1",
      words: Array.from(this.words),
      bytes: this.count,
      pending: this.pending.toString("base64url"),
    };
  }
  update(input: Uint8Array): this {
    if (this.count + input.byteLength > LIMITS.segmentBytes) invalid();
    this.count += input.byteLength;
    let offset = 0;
    if (this.pending.length) {
      const needed = Math.min(64 - this.pending.length, input.byteLength);
      this.pending = Buffer.concat([this.pending, input.subarray(0, needed)]);
      offset = needed;
      if (this.pending.length < 64) return this;
      this.block(this.pending, 0);
      this.pending = Buffer.alloc(0);
    }
    for (; offset + 64 <= input.byteLength; offset += 64)
      this.block(input, offset);
    this.pending = Buffer.from(input.subarray(offset));
    return this;
  }
  digest(): string {
    const copy = new ResumableSha256(this.snapshot());
    const padding = Buffer.alloc(this.pending.length < 56 ? 64 : 128);
    this.pending.copy(padding);
    padding[this.pending.length] = 0x80;
    padding.writeBigUInt64BE(BigInt(this.count) * 8n, padding.length - 8);
    for (let offset = 0; offset < padding.length; offset += 64)
      copy.block(padding, offset);
    const out = Buffer.alloc(32);
    copy.words.forEach((word, i) => {
      out.writeUInt32BE(word, i * 4);
    });
    return out.toString("hex");
  }
  private block(input: Uint8Array, offset: number): void {
    const w = this.schedule;
    for (let i = 0; i < 16; i++) {
      const at = offset + i * 4;
      w[i] =
        (input[at] << 24) |
        (input[at + 1] << 16) |
        (input[at + 2] << 8) |
        input[at + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15],
        y = w[i - 2];
      w[i] =
        w[i - 16] +
        (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) +
        w[i - 7] +
        (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = this.words;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          K[i] +
          w[i]) >>>
        0;
      const t2 =
        ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => {
      this.words[i] = (this.words[i] + value) >>> 0;
    });
  }
}
