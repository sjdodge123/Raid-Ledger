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
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
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
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${AD_HOC_GAME_SPAWN_LOCK_CLASS}::int4, ${gameId}::int4)`,
    );
    return fn(tx);
  });
}

/**
 * Event rows reusable by a spawn from `bindingId`: no creating binding
 * (server-born) or a creating binding on the SAME Discord channel.
 * ROK-1851: a lobby + a game monitor on one channel share one Quick Play.
 * A Quick Play born on another channel stays separate (ROK-1800 rule).
 */
function bornOnSpawningChannel(bindingId: string): SQL | undefined {
  const e = schema.events;
  return or(
    isNull(e.channelBindingId),
    sql`${e.channelBindingId} IN (
      SELECT cb.id FROM channel_bindings cb
      JOIN channel_bindings me ON me.channel_id = cb.channel_id
      WHERE me.id = ${bindingId})`,
  );
}

/**
 * The live event a VOICE spawn must join instead of creating one: the game's
 * live (or in-grace) Quick Play that is server-born or was created by a
 * binding on the spawning binding's Discord channel.
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
        bornOnSpawningChannel(bindingId),
      ),
    )
    // No `.limit(1)`: at most a handful of rows, and it keeps this lookup
    // transparent to the voice unit specs' sequenced `limit` mocks.
    .orderBy(desc(e.id));
  return rows[0] ?? null;
}

/**
 * The voice path's create: under the game's spawn lock, join the game's live
 * same-channel (or server-born) Quick Play when one exists (the caller
 * registers it under its own key), else insert.
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
          const live = await findVoiceSpawnTarget(tx, gameId, bindingId);
          if (live) return { eventId: live.id, existing: true };
          return { eventId: await create(tx), existing: false };
        });
  if (!result.existing)
    logger.log(
      `Voice binding ${bindingId} spawned Quick Play ${result.eventId}`,
    );
  return result;
}
