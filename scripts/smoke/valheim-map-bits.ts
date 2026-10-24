/**
 * ROK-1949 — pure bitset scans for the Map-tab smoke spec. Kept free of
 * `@playwright/test` on purpose: a scan touches millions of bits, and a
 * Playwright `expect()` per bit (≈20 µs plus a report step each) blocked the
 * worker's event loop for minutes, so the test timeout could never fire and
 * three CI shards hung to the job timeout. Callers assert lengths first.
 */

/** Bit `i` of `bits` (LSB-first); throws when `i` is past the end. */
export function bitSet(bits: Uint8Array, i: number): boolean {
  const byte = bits[i >> 3];
  if (byte === undefined) throw new Error(`bit ${i} is past ${bits.length} B`);
  return ((byte >> (i & 7)) & 1) === 1;
}

/** First texel (px, py) of an n² grid matching `want` in `a ∪ b`. */
export function findTexel(
  n: number,
  a: Uint8Array,
  b: Uint8Array,
  want: boolean,
): { px: number; py: number } | null {
  for (let i = 0; i < n * n; i++) {
    if ((bitSet(a, i) || bitSet(b, i)) === want)
      return { px: i % n, py: Math.floor(i / n) };
  }
  return null;
}
