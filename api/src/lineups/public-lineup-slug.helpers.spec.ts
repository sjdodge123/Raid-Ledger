/**
 * Unit tests for public-lineup-slug.helpers (ROK-1067).
 *
 * Covers:
 *   - `generatePublicSlug()` returns a 12-char URL-safe slug string
 *     matching `/^[A-Za-z0-9_-]{12}$/`.
 *   - Successive calls produce different slugs (no static state).
 *   - `insertWithSlugRetry(cb)` retries up to 3x when `cb` throws a
 *     Postgres `unique_violation` (code 23505), succeeds on retry, and
 *     bubbles the result.
 *   - `insertWithSlugRetry(cb)` rethrows after exhausting retries.
 *
 * TDD gate: the helper file does not exist yet — the import below
 * fails, which is the desired baseline.
 */
import {
  ALPHABET,
  generatePublicSlug,
  insertWithSlugRetry,
  SLUG_LENGTH,
} from './public-lineup-slug.helpers';

const SLUG_REGEX = /^[A-Za-z0-9_-]{12}$/;

class FakeUniqueViolation extends Error {
  code = '23505';
  constructor(msg = 'duplicate key value violates unique constraint') {
    super(msg);
    this.name = 'PostgresError';
  }
}

describe('public-lineup-slug.helpers (ROK-1067)', () => {
  describe('generatePublicSlug', () => {
    // The alphabet MUST stay a power of two. `generatePublicSlug` masks a
    // random byte with `ALPHABET.length - 1` instead of rejection-sampling,
    // which is unbiased ONLY at 2^n. At 62 characters the mask would skew
    // toward the low characters; at 65 it would never emit the last one.
    // Neither shows up as a test failure anywhere else — the slugs still look
    // fine — so this is the assertion that has to catch it.
    it('draws from a power-of-two alphabet, so the byte mask is unbiased', () => {
      expect(ALPHABET.length).toBe(64);
      expect(ALPHABET.length & (ALPHABET.length - 1)).toBe(0);
      expect(new Set(ALPHABET).size).toBe(ALPHABET.length);
    });

    it('can emit every character in the alphabet', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 5000; i++) {
        for (const ch of generatePublicSlug()) seen.add(ch);
      }
      // 5000 slugs = 60000 draws over 64 characters; missing one would mean
      // the mask does not cover the alphabet.
      expect(seen.size).toBe(ALPHABET.length);
    });

    it('returns a 12-char URL-safe slug', () => {
      const slug = generatePublicSlug();
      expect(typeof slug).toBe('string');
      expect(slug).toMatch(SLUG_REGEX);
      expect(slug.length).toBe(SLUG_LENGTH);
    });

    it('produces different slugs across calls (no shared static state)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(generatePublicSlug());
      }
      // 50 draws of 12 chars from a 64-char alphabet collide with
      // probability ~50^2 / (2 * 64^12) ≈ 1.4e-19 — effectively never.
      expect(seen.size).toBe(50);
    });
  });

  describe('insertWithSlugRetry', () => {
    it('returns the callback result on first success (no retries)', async () => {
      // eslint-disable-next-line @typescript-eslint/require-await
      const cb = jest.fn(async (slug: string) => ({ slug, ok: true }));

      const result = await insertWithSlugRetry(cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(result.slug).toMatch(SLUG_REGEX);
    });

    it('retries up to 3 times on unique_violation, succeeds on retry', async () => {
      let calls = 0;
      // eslint-disable-next-line @typescript-eslint/require-await
      const cb = jest.fn(async (slug: string) => {
        calls++;
        if (calls < 3) throw new FakeUniqueViolation();
        return { slug, ok: true };
      });

      const result = await insertWithSlugRetry(cb);
      expect(cb).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(true);
      expect(result.slug).toMatch(SLUG_REGEX);
    });

    it('throws after exhausting retries (default 3 attempts)', async () => {
      // eslint-disable-next-line @typescript-eslint/require-await
      const cb = jest.fn(async () => {
        throw new FakeUniqueViolation();
      });

      await expect(insertWithSlugRetry(cb)).rejects.toThrow();
      expect(cb).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry on a non-unique-violation error', async () => {
      const boom = new Error('boom');
      // eslint-disable-next-line @typescript-eslint/require-await
      const cb = jest.fn(async () => {
        throw boom;
      });

      await expect(insertWithSlugRetry(cb)).rejects.toBe(boom);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});
