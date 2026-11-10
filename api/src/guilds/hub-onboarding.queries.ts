import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubOnboardingDismissalDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { fromStorageKey } from './hub-onboarding.helpers';

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
  // Parsed, not cast: the column is text, and a key the enum no longer knows
  // (a retired prompt left behind by an older release) must not be handed to
  // the web as a valid one — it is dropped instead. ROK-2153 N4: a scoped row
  // (`claim-character:<scope>`) is split back into `{ key, scope }`; `scope`
  // is emitted only when present.
  return rows.flatMap((row) => {
    const parsed = fromStorageKey(row.key);
    if (parsed === null) return [];
    return [
      {
        key: parsed.key,
        guildId: row.guildId,
        ...(parsed.scope !== null ? { scope: parsed.scope } : {}),
        dismissedAt: row.dismissedAt.toISOString(),
      },
    ];
  });
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

/** Does this guild exist? A scoped dismissal for one that does not is a 404. */
export async function guildExists(db: Db, guildId: number): Promise<boolean> {
  const rows = await db
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  return rows.length > 0;
}
