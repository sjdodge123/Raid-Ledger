/**
 * ROK-1599: the private ICS subscribe-link token (epic ROK-669 §6.3).
 *
 * The token is a bearer secret: 32 random bytes as 43 base64url chars.
 * Stored twice — `token_hash` (sha256 hex, the lookup key) and
 * `token_encrypted` (so the owner can see their link again). Lookups compare
 * hashes in constant time. NEVER log a token or its hash; log the user id.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { decrypt, encrypt } from '../../settings/encryption.util';

type Db = PostgresJsDatabase<typeof schema>;

const FEED_TOKEN_BYTES = 32;

/** Exact shape `generateFeedToken` produces; anything else is a 404. */
export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A fresh, URL-safe, 256-bit feed token. */
export function generateFeedToken(): string {
  return randomBytes(FEED_TOKEN_BYTES).toString('base64url');
}

/** sha256 of the token as 64 lower-case hex chars (the `token_hash`). */
export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time compare of two hex hashes; false on any length mismatch. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Create the user's feed, or rotate it (new token, `rotated_at` stamped) when
 * one exists — the old token stops resolving at once. Returns the plaintext.
 */
export async function upsertFeedToken(db: Db, userId: number): Promise<string> {
  const token = generateFeedToken();
  const tokenHash = hashFeedToken(token);
  const tokenEncrypted = encrypt(token);
  await db
    .insert(schema.calendarFeeds)
    .values({ userId, tokenHash, tokenEncrypted })
    .onConflictDoUpdate({
      target: schema.calendarFeeds.userId,
      set: { tokenHash, tokenEncrypted, rotatedAt: sql`now()` },
    });
  return token;
}

/** Delete the user's feed. True when a feed existed. */
export async function revokeFeed(db: Db, userId: number): Promise<boolean> {
  const rows = await db
    .delete(schema.calendarFeeds)
    .where(eq(schema.calendarFeeds.userId, userId))
    .returning({ userId: schema.calendarFeeds.userId });
  return rows.length > 0;
}

/** The user's current token (decrypted), or null when they have no feed. */
export async function loadFeedToken(
  db: Db,
  userId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ tokenEncrypted: schema.calendarFeeds.tokenEncrypted })
    .from(schema.calendarFeeds)
    .where(eq(schema.calendarFeeds.userId, userId))
    .limit(1);
  return row ? decrypt(row.tokenEncrypted) : null;
}

/**
 * The feed owner's user id, or null for a malformed / unknown / revoked
 * token, or when the owner is banned or deactivated — a ban blocks every
 * auth path, and this bearer link is one (the row survives a ban without a
 * data wipe, so an unban restores the same link). A malformed token never
 * reaches the database.
 */
export async function findFeedUserByToken(
  db: Db,
  token: string,
): Promise<number | null> {
  if (!FEED_TOKEN_PATTERN.test(token)) return null;
  const hash = hashFeedToken(token);
  const [row] = await db
    .select({
      userId: schema.calendarFeeds.userId,
      tokenHash: schema.calendarFeeds.tokenHash,
      bannedAt: schema.users.bannedAt,
      deactivatedAt: schema.users.deactivatedAt,
    })
    .from(schema.calendarFeeds)
    .innerJoin(schema.users, eq(schema.users.id, schema.calendarFeeds.userId))
    .where(eq(schema.calendarFeeds.tokenHash, hash))
    .limit(1);
  if (!row || !hashesEqual(row.tokenHash, hash)) return null;
  if (row.bannedAt !== null || row.deactivatedAt !== null) return null;
  return row.userId;
}
