/**
 * Slug helpers for the public-shareable lineup link (ROK-1067).
 *
 * Slugs come from `node:crypto` directly rather than `nanoid`: the alphabet is
 * a power of two, so raw random bytes are already unbiased (see ALPHABET_MASK).
 *
 * Extracted into its own module so the retry-on-collision logic is
 * unit-testable in isolation. The caller passes a callback that performs
 * the actual insert; the helper handles slug generation and retry on
 * Postgres unique-violation (SQLSTATE 23505).
 */
import { randomBytes } from 'node:crypto';

/** URL-safe alphabet (64 chars: A-Z, a-z, 0-9, _, -). */
export const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';

/** Slug length — 12 chars from 64-char alphabet ≈ 72 bits of entropy. */
export const SLUG_LENGTH = 12;

/**
 * Six bits per character — the ONLY reason this needs no rejection sampling.
 *
 * `ALPHABET.length` is 64 = 2^6, so `byte & 63` maps six uniform bits onto
 * exactly one character with NO modulo bias, and every draw is usable. That is
 * precisely the guarantee `nanoid`'s `customAlphabet` provided, so dropping the
 * dependency costs nothing HERE — but the equivalence holds only while the
 * alphabet is a power of two. At 62 characters `% 62` would skew toward the low
 * characters, and at 65 the mask would stop covering the alphabet at all.
 * `public-lineup-slug.helpers.spec.ts` pins the length so neither lands quietly.
 */
const ALPHABET_MASK = ALPHABET.length - 1;

/** Generate a fresh public slug. URL-safe, ~72 bits of entropy. */
export function generatePublicSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += ALPHABET[bytes[i] & ALPHABET_MASK];
  }
  return slug;
}

/** Default retry budget for slug-collision insertion attempts. */
export const DEFAULT_SLUG_RETRY_ATTEMPTS = 3;

/**
 * Insert with retry-on-unique-violation for the public slug.
 *
 * Calls `tryInsert(slug)` with a fresh slug each attempt. If the callback
 * throws a Postgres unique-violation (`code === '23505'`), the helper
 * retries up to `maxAttempts` times. Any other error is rethrown
 * immediately so callers see real failures.
 *
 * @param tryInsert callback that attempts the insert and returns the row(s)
 * @param maxAttempts retry budget (default 3)
 */
export async function insertWithSlugRetry<T>(
  tryInsert: (slug: string) => Promise<T>,
  maxAttempts = DEFAULT_SLUG_RETRY_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = generatePublicSlug();
    try {
      return await tryInsert(slug);
    } catch (err) {
      lastErr = err;
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error(
    `Failed to allocate unique lineup slug after ${maxAttempts} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/** Postgres unique-violation guard — `code === '23505'`. */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string };
  return e.code === '23505';
}
