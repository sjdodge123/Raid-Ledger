/**
 * ROK-1960 — a dependency-free, synchronous SHA-256 (FIPS 180-4). The browser
 * parse path prefers WebCrypto, but `crypto.subtle` is undefined outside a
 * secure context — e.g. the documented plain-HTTP LAN self-host
 * (`http://<nas>:8080`) — so this fallback keeps campaign-key hashing working
 * there with byte-identical output.
 */

/** The 64 round constants: first 32 bits of the cube roots of the first 64 primes. */
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

/** Initial hash value: first 32 bits of the square roots of the first 8 primes. */
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Message + 0x80 + zero fill + 64-bit big-endian bit length, to a multiple of 64 bytes. */
function padMessage(bytes: Uint8Array): DataView {
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const bitLength = bytes.length * 8;
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    return view;
}

/** The 64-word message schedule for the block at `offset`. */
function schedule(view: DataView, offset: number): Uint32Array {
    const w = new Uint32Array(64);
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
        const a = w[t - 15] ?? 0;
        const b = w[t - 2] ?? 0;
        const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
        const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
        w[t] = (w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1;
    }
    return w;
}

/** One compression round over a 64-byte block; mutates `state` (8 words). */
function compressBlock(state: Uint32Array, view: DataView, offset: number): void {
    const w = schedule(view, offset);
    const v = Uint32Array.from(state);
    for (let t = 0; t < 64; t++) {
        const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = v;
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const t1 = h + s1 + ((e & f) ^ (~e & g)) + (K[t] ?? 0) + (w[t] ?? 0);
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const t2 = s0 + ((a & b) ^ (a & c) ^ (b & c));
        v.set([t1 + t2, a, b, c, d + t1, e, f, g]);
    }
    for (let i = 0; i < 8; i++) state[i] = (state[i] ?? 0) + (v[i] ?? 0);
}

/** The 8-word state as 64 lowercase hex characters. */
function toHex(state: Uint32Array): string {
    return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('');
}

/** Lowercase hex SHA-256 of `bytes`, computed synchronously in plain JS. */
export function sha256HexSync(bytes: Uint8Array): string {
    const view = padMessage(bytes);
    const state = Uint32Array.from(H0);
    for (let offset = 0; offset < view.byteLength; offset += 64) compressBlock(state, view, offset);
    return toHex(state);
}

/** True iff WebCrypto's `subtle.digest` is usable (secure context). */
export function hasSubtleCrypto(): boolean {
    return typeof globalThis.crypto?.subtle?.digest === 'function';
}
