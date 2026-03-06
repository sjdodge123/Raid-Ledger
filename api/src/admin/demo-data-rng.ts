/**
 * Seeded PRNG utilities for deterministic demo data generation.
 */

const DEFAULT_SEED = 0xdeadbeef;

/** mulberry32 — fast 32-bit seeded PRNG */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** Create a seeded PRNG instance. */
export function createRng(seed = DEFAULT_SEED): Rng {
  return mulberry32(seed);
}

/** Pick a random element from an array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick() called on empty array');
  return arr[Math.floor(rng() * arr.length)];
}

/** Pick N random elements from an array. */
export function pickN<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  shuffle(rng, copy);
  return copy.slice(0, Math.min(n, copy.length));
}

/** Generate a random integer in [min, max]. */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Shuffle an array in place using Fisher-Yates. */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick an element from a weighted array. */
export function weightedPick<T>(
  rng: Rng,
  items: readonly T[],
  weights: readonly number[],
): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
