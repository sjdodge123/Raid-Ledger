/**
 * ROK-1800 — one Quick Play per game, across spawn paths and processes.
 *
 * The voice path and the game-server path each do find-live-then-create for a
 * game. Without a shared lock both can see "no live event" and insert, leaving
 * two live Quick Plays with split rosters. The transaction-scoped advisory
 * lock (keyed on the game id) holds for the whole find-then-create; work MUST
 * use the `tx` handed to `fn`, and anything the creator enrols in the same
 * callback commits atomically with the event row.
 *
 * No catch-and-retry inside: under postgres.js a failed statement poisons the
 * whole transaction (see CLAUDE.md, games-table INSERT paths).
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { LiveGameEvent } from './ad-hoc-server-presence.helpers';
import { createAdHocEventRow, findAdminFallback } from './ad-hoc-event.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Advisory-lock class for per-game Quick Play spawns (two-int form). */
export const AD_HOC_GAME_SPAWN_LOCK_CLASS = 1801;

/** Run `fn` in a transaction holding the game's spawn lock. */
export async function withGameSpawnLock<T>(
  db: Db,
  gameId: number,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${AD_HOC_GAME_SPAWN_LOCK_CLASS}::int4, ${gameId}::int4)`,
    );
    return fn(tx);
  });
}

/**
 * The live event a VOICE spawn must join instead of creating one: the game's
 * live Quick Play that is server-born (no binding) or already on this
 * binding. Another voice binding's event for the same game stays separate,
 * as it was before ROK-1800.
 */
export async function findVoiceSpawnTarget(
  db: Db,
  gameId: number,
  bindingId: string,
): Promise<LiveGameEvent | null> {
  const e = schema.events;
  const rows = await db
    .select({
      id: e.id,
      channelBindingId: e.channelBindingId,
      adHocStatus: e.adHocStatus,
    })
    .from(e)
    .where(
      and(
        eq(e.isAdHoc, true),
        eq(e.gameId, gameId),
        inArray(e.adHocStatus, ['live', 'grace_period']),
        isNull(e.cancelledAt),
        or(isNull(e.channelBindingId), eq(e.channelBindingId, bindingId)),
      ),
    )
    .orderBy(desc(e.id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The voice path's create: under the game's spawn lock, join the live
 * server-born (or same-binding) Quick Play when one exists, else insert.
 * A null game (general lobby) has nothing to dedup against and skips it.
 */
export async function createVoiceQuickPlay(
  db: Db,
  bindingId: string,
  binding: { gameId: number | null | undefined },
  trigger: { userId: number | null },
  resolvedGameName?: string,
): Promise<{ eventId: number; existing: boolean } | null> {
  const creatorId = trigger.userId ?? (await findAdminFallback(db));
  if (!creatorId) return null;
  const gameId = binding.gameId ?? null;
  const create = (on: Db) =>
    createAdHocEventRow(on, bindingId, { gameId }, creatorId, resolvedGameName);
  if (gameId === null) return { eventId: await create(db), existing: false };
  return withGameSpawnLock(db, gameId, async (tx) => {
    const live = await findVoiceSpawnTarget(tx, gameId, bindingId);
    if (live) return { eventId: live.id, existing: true };
    return { eventId: await create(tx), existing: false };
  });
}
