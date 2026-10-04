/**
 * Browser stand-in for node:crypto with the few functions Billforce uses. scrypt
 * is the same algorithm and settings as on the server, so password hashes and
 * backups move between the server and the browser edition unchanged.
 */
import { Buffer } from 'buffer';
import { scrypt } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha2';

const bytesOf = (v: string | Uint8Array) => (typeof v === 'string' ? new TextEncoder().encode(v) : v);

// The npm "buffer" package (Buffer in the browser) has no "base64url" encoding, which Billforce uses for tokens.
try {
  Buffer.from([0]).toString('base64url');
} catch {
  const toString = Buffer.prototype.toString;
  Buffer.prototype.toString = function (this: Buffer, encoding?: string, start?: number, end?: number) {
    if (encoding === 'base64url') return toString.call(this, 'base64', start, end).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return toString.call(this, encoding as BufferEncoding, start, end);
  } as typeof Buffer.prototype.toString;
}

export function randomBytes(size: number): Buffer {
  const out = Buffer.alloc(size);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Random integer in [min, max) (or [0, max) with one argument), without modulo bias. */
export function randomInt(a: number, b?: number): number {
  const [min, max] = b === undefined ? [0, a] : [a, b];
  const range = max - min;
  if (!(range > 0) || range > 2 ** 32) throw new RangeError('randomInt: invalid range');
  const limit = 2 ** 32 - (2 ** 32 % range);
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return min + (buf[0] % range);
}

export function scryptSync(password: string | Uint8Array, salt: string | Uint8Array, keylen: number, opts: { N?: number; r?: number; p?: number } = {}): Buffer {
  return Buffer.from(scrypt(bytesOf(password), bytesOf(salt), { N: opts.N ?? 16384, r: opts.r ?? 8, p: opts.p ?? 1, dkLen: keylen }));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function createHash(algorithm: string) {
  if (algorithm.toLowerCase() !== 'sha256') throw new Error(`Hash "${algorithm}" is not available in the browser`);
  const hash = sha256.create();
  const api = {
    update(data: string | Uint8Array) {
      hash.update(bytesOf(data));
      return api;
    },
    digest(encoding?: 'hex' | 'base64' | 'base64url') {
      const out = Buffer.from(hash.digest());
      return encoding ? out.toString(encoding) : out;
    },
  };
  return api;
}

export default { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash };
