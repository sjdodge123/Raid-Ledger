/**
 * Moderation DB writes for UsersService (ROK-313 §3b).
 * Pure, idempotent UPDATE statements — orchestration (cache invalidation, token
 * revoke, audit, signup-cancel, wipe, Discord kick) lives in
 * `users-moderation-orchestration.helpers.ts` so this file stays a thin,
 * side-effect-free data layer.
 *
 * Idempotency is enforced with `WHERE ... IS NULL RETURNING`: a retry on an
 * already-kicked/-banned user returns no row, so the orchestrator skips the
 * double-log / double-cancel (§9.5 step 2, §9.10 #4).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Row shape returned by the moderation writes (enough to drive the cascade). */
export interface ModerationRow {
  id: number;
  username: string;
  discordId: string | null;
}

const MODERATION_RETURNING = {
  id: schema.users.id,
  username: schema.users.username,
  discordId: schema.users.discordId,
} as const;

/**
 * Kick a user (soft removal): set `kicked_at`/`kick_reason` only if the user is
 * neither already kicked nor banned. Returns the row on a state change, else
 * `undefined` (idempotent). Does NOT touch `deactivated_at` — kick preserves data
 * (AC2); cancelled signups would be lost on the 5-minute re-auth.
 */
export async function kickUserById(
  db: Db,
  userId: number,
  reason?: string,
): Promise<ModerationRow | undefined> {
  const [row] = await db
    .update(schema.users)
    .set({ kickedAt: sql`NOW()`, kickReason: reason ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.users.id, userId),
        isNull(schema.users.kickedAt),
        isNull(schema.users.bannedAt),
      ),
    )
    .returning(MODERATION_RETURNING);
  return row;
}

/**
 * Clear a kick (admin unkick). Idempotent — only matches a currently-kicked user
 * (`kicked_at IS NOT NULL`) so a repeat click returns `undefined` and the
 * orchestrator skips a duplicate audit row.
 */
export async function unkickUserById(
  db: Db,
  userId: number,
): Promise<ModerationRow | undefined> {
  const [row] = await db
    .update(schema.users)
    .set({ kickedAt: null, kickReason: null, updatedAt: new Date() })
    .where(and(eq(schema.users.id, userId), isNotNull(schema.users.kickedAt)))
    .returning(MODERATION_RETURNING);
  return row;
}

/**
 * Ban a user: set `banned_at`/`ban_reason`, deactivate (drop from Players list —
 * COALESCE keeps an existing guild-leave timestamp), and supersede any kick.
 * Idempotent via `banned_at IS NULL` (§9.5 step 1).
 */
export async function banUserById(
  db: Db,
  userId: number,
  reason?: string,
): Promise<ModerationRow | undefined> {
  const [row] = await db
    .update(schema.users)
    .set({
      bannedAt: sql`NOW()`,
      banReason: reason ?? null,
      deactivatedAt: sql`COALESCE(${schema.users.deactivatedAt}, NOW())`,
      kickedAt: null,
      kickReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.bannedAt)))
    .returning(MODERATION_RETURNING);
  return row;
}

/**
 * Clear a ban (`banned_at`/`ban_reason`). Idempotent — only matches a
 * currently-banned user (`banned_at IS NOT NULL`). Does NOT clear
 * `deactivated_at`: a banned user stays out of the Players list until an admin
 * separately reactivates them (COALESCE means we cannot tell whether the ban or a
 * prior guild-leave set it). Returns the row when one matched.
 */
export async function unbanUserById(
  db: Db,
  userId: number,
): Promise<ModerationRow | undefined> {
  const [row] = await db
    .update(schema.users)
    .set({ bannedAt: null, banReason: null, updatedAt: new Date() })
    .where(and(eq(schema.users.id, userId), isNotNull(schema.users.bannedAt)))
    .returning(MODERATION_RETURNING);
  return row;
}
