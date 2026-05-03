/**
 * Unit tests for public-lineup-slug.helpers (ROK-1067).
 *
 * Covers:
 *   - `generatePublicSlug()` returns a 12-char URL-safe nanoid string
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
  generatePublicSlug,
  insertWithSlugRetry,
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
    it('returns a 12-char URL-safe slug', () => {
      const slug = generatePublicSlug();
      expect(typeof slug).toBe('string');
      expect(slug).toMatch(SLUG_REGEX);
      expect(slug.length).toBe(12);
    });

    it('produces different slugs across calls (no shared static state)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(generatePublicSlug());
      }
      // 50 nanoid(12) draws from a 64-char alphabet collide with
      // probability ~50^2 / (2 * 64^12) ≈ 1.4e-19 — effectively never.
      expect(seen.size).toBe(50);
    });
  });

  describe('insertWithSlugRetry', () => {
    it('returns the callback result on first success (no retries)', async () => {
      const cb = jest.fn(async (slug: string) => ({ slug, ok: true }));

      const result = await insertWithSlugRetry(cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(result.slug).toMatch(SLUG_REGEX);
    });

    it('retries up to 3 times on unique_violation, succeeds on retry', async () => {
      let calls = 0;
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
      const cb = jest.fn(async () => {
        throw new FakeUniqueViolation();
      });

      await expect(insertWithSlugRetry(cb)).rejects.toThrow();
      expect(cb).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry on a non-unique-violation error', async () => {
      const boom = new Error('boom');
      const cb = jest.fn(async () => {
        throw boom;
      });

      await expect(insertWithSlugRetry(cb)).rejects.toBe(boom);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});
