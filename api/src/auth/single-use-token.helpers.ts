import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/**
 * Hash a token with SHA-256 for storage (avoids storing raw JWTs).
 * @returns Hex-encoded SHA-256 hash (64 characters)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Atomically mark `token` consumed (ROK-979 pattern, shared by ROK-1366).
 * INSERT … ON CONFLICT DO NOTHING RETURNING on the unique token_hash, so of
 * two concurrent consumers exactly one gets `true`. DB errors propagate.
 * Rows are purged after 15m by IntentTokenCleanupService (≥ every TTL here).
 */
export async function consumeTokenOnce(
  db: PostgresJsDatabase<typeof schema>,
  token: string,
): Promise<boolean> {
  const result = await db
    .insert(schema.consumedIntentTokens)
    .values({ tokenHash: hashToken(token) })
    .onConflictDoNothing()
    .returning({ id: schema.consumedIntentTokens.id });
  return result.length > 0;
}
