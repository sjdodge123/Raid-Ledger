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
import { Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { LiveGameEvent } from './ad-hoc-server-presence.helpers';
import { createAdHocEventRow, findAdminFallback } from './ad-hoc-event.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const logger = new Logger('AdHocGameSpawn');

/** Advisory-lock class for per-game Quick Play spawns (two-int form). */
export const AD_HOC_GAME_SPAWN_LOCK_CLASS = 1801;

/** Run `fn` in a transaction holding the game's spawn lock. */
export async function withGameSpawnLock<T>(
  db: Db,
  gameId: number,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockGameSpawn(tx, gameId);
    return fn(tx);
  });
}

/**
 * Take the game's spawn lock inside a transaction the caller already holds
 * (ROK-1888: the LFG-now spawn, which also holds its own group lock).
 */
export async function lockGameSpawn(tx: Db, gameId: number): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${AD_HOC_GAME_SPAWN_LOCK_CLASS}::int4, ${gameId}::int4)`,
  );
}

/**
 * ROK-1888: the ONE "live Quick Play of a game" predicate — live or in grace,
 * not cancelled, whatever binding created it. `gameFilter` picks the game(s),
 * e.g. `eq(events.gameId, id)` or `inArray(events.gameId, ids)`.
 */
export function liveQuickPlayFilter(gameFilter: SQL): SQL | undefined {
  const e = schema.events;
  return and(
    eq(e.isAdHoc, true),
    gameFilter,
    inArray(e.adHocStatus, ['live', 'grace_period']),
    isNull(e.cancelledAt),
  );
}

/**
 * ROK-1888: which of `gameIds` already have a live Quick Play anywhere. Read
 * only and unlocked — the voice gates use it to skip `minPlayers` for a game
 * that is already live, so a lone player in another channel joins it.
 */
export async function findLiveQuickPlayGameIds(
  db: Db,
  gameIds: readonly number[],
): Promise<Set<number>> {
  if (gameIds.length === 0) return new Set();
  const e = schema.events;
  const rows = await db
    .select({ gameId: e.gameId })
    .from(e)
    .where(liveQuickPlayFilter(inArray(e.gameId, [...gameIds])));
  return new Set(rows.flatMap((r) => (r.gameId === null ? [] : [r.gameId])));
}

/**
 * The live event a VOICE spawn must join instead of creating one: the game's
 * live (or in-grace) Quick Play from ANY channel or the game server
 * (ROK-1888 ruling 3 — replaces the ROK-1800 same-channel scope).
 */
export async function findVoiceSpawnTarget(
  db: Db,
  gameId: number,
): Promise<LiveGameEvent | null> {
  const e = schema.events;
  const rows = await db
    .select({
      id: e.id,
      channelBindingId: e.channelBindingId,
      adHocStatus: e.adHocStatus,
    })
    .from(e)
    .where(liveQuickPlayFilter(eq(e.gameId, gameId)))
    // No `.limit(1)`: at most a handful of rows, and it keeps this lookup
    // transparent to the voice unit specs' sequenced `limit` mocks.
    .orderBy(desc(e.id));
  return rows[0] ?? null;
}

/**
 * The voice path's create: under the game's spawn lock, join the game's live
 * Quick Play from any channel when one exists (the caller registers it under
 * its own key, sharing the event's state), else insert. Two channels spawning
 * at once serialise on the lock; the second sees the first's row.
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
  const result =
    gameId === null
      ? { eventId: await create(db), existing: false }
      : await withGameSpawnLock(db, gameId, async (tx) => {
          const live = await findVoiceSpawnTarget(tx, gameId);
          if (live) return { eventId: live.id, existing: true };
          return { eventId: await create(tx), existing: false };
        });
  if (!result.existing)
    logger.log(
      `Voice binding ${bindingId} spawned Quick Play ${result.eventId}`,
    );
  return result;
}
