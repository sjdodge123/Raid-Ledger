/**
 * Slug helpers for the public-shareable lineup link (ROK-1067).
 *
 * Extracted into its own module so the retry-on-collision logic is
 * unit-testable in isolation. The caller passes a callback that performs
 * the actual insert; the helper handles slug generation and retry on
 * Postgres unique-violation (SQLSTATE 23505).
 */
import { customAlphabet } from 'nanoid';

/** URL-safe alphabet (64 chars: A-Z, a-z, 0-9, _, -). */
const ALPHABET =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';

/** Slug length — 12 chars from 64-char alphabet ≈ 72 bits of entropy. */
export const SLUG_LENGTH = 12;

const generate = customAlphabet(ALPHABET, SLUG_LENGTH);

/** Generate a fresh public slug. URL-safe, ~72 bits of entropy. */
export function generatePublicSlug(): string {
    return generate();
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
