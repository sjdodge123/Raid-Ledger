import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubOnboardingDismissalDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1830 S5 — every query is scoped by `userId`, which is taken from the
 * JWT and never from the request body: a caller can only read or write their
 * own dismissals.
 */

/** Matches one prompt in one scope; NULL `guildId` is the global scope. */
function scopeWhere(userId: number, key: string, guildId: number | null) {
  const t = schema.hubOnboardingDismissals;
  return and(
    eq(t.userId, userId),
    eq(t.key, key),
    guildId === null ? isNull(t.guildId) : eq(t.guildId, guildId),
  );
}

/** The caller's dismissals, oldest first. */
export async function listDismissals(
  db: Db,
  userId: number,
): Promise<HubOnboardingDismissalDto[]> {
  const t = schema.hubOnboardingDismissals;
  const rows = await db
    .select({ key: t.key, guildId: t.guildId, dismissedAt: t.dismissedAt })
    .from(t)
    .where(eq(t.userId, userId))
    .orderBy(t.dismissedAt, t.id);
  return rows.map((row) => ({
    key: row.key as HubOnboardingDismissalDto['key'],
    guildId: row.guildId,
    dismissedAt: row.dismissedAt.toISOString(),
  }));
}

/**
 * Idempotent: a second dismiss of the same prompt is a no-op, not a 409.
 * `ON CONFLICT DO NOTHING` with no target covers both unique indexes (the
 * scoped one and the partial global one).
 */
export async function insertDismissal(
  db: Db,
  userId: number,
  key: string,
  guildId: number | null,
): Promise<void> {
  await db
    .insert(schema.hubOnboardingDismissals)
    .values({ userId, key, guildId })
    .onConflictDoNothing();
}

/** Undo. Deleting a prompt that was never dismissed is a no-op. */
export async function deleteDismissal(
  db: Db,
  userId: number,
  key: string,
  guildId: number | null,
): Promise<void> {
  await db
    .delete(schema.hubOnboardingDismissals)
    .where(scopeWhere(userId, key, guildId));
}
