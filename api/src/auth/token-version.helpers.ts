/**
 * ROK-1823: the per-user token version. Every session access token carries
 * the holder's `users.token_version` as its `tv` claim; bumping the column
 * revokes every access token minted before the bump at once. Lives in
 * Postgres (not Redis) so a bump can share a transaction with the refresh-row
 * revoke, and a Redis loss can never silently un-revoke a session.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** `token_version + 1` — usable inside any UPDATE of `users` (e.g. setRole). */
export const NEXT_TOKEN_VERSION = sql<number>`${schema.users.tokenVersion} + 1`;

/**
 * Bump `userId`'s version and return the NEW value. Pass a transaction to
 * make the bump commit (or roll back) with the rest of a revoke. Throws when
 * no such user exists — a revoke that silently touched nothing is a bug.
 * Callers invalidate the auth-user cache AFTER the commit.
 */
export async function bumpTokenVersion(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .update(schema.users)
    .set({ tokenVersion: NEXT_TOKEN_VERSION })
    .where(eq(schema.users.id, userId))
    .returning({ tokenVersion: schema.users.tokenVersion });
  if (!row) throw new Error(`ROK-1823: cannot bump token version: user ${userId} not found`);
  return row.tokenVersion;
}

/** Read `userId`'s current version. Throws when no such user exists. */
export async function readTokenVersion(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({ tokenVersion: schema.users.tokenVersion })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) throw new Error(`ROK-1823: cannot read token version: user ${userId} not found`);
  return row.tokenVersion;
}
