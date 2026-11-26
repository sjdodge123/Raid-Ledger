/**
 * ROK-2352 — the live Quick Play the Any (`''`) group may fall back onto.
 *
 * `findOpenSession('')` first looks for an event the Any group's own hands
 * converted into; failing that it joins the game's live Quick Play (ROK-1888,
 * one live Quick Play per game). A keyed group's Start now session (a WoW
 * dungeon run) is itself a live Quick Play of the game, so the unscoped
 * `findVoiceSpawnTarget` could hand the Any group that session — rostering Any
 * members into another group's run. This read skips every event a keyed
 * group's hands converted into.
 */
import { and, desc, eq, ne, notExists } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { liveQuickPlayFilter } from '../services/ad-hoc-game-spawn-lock';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The game's newest live Quick Play that no keyed group's hands converted into.
 *
 * @param db - The spawn transaction handle.
 * @param gameId - Game whose Any group is deciding.
 * @returns The event id, or null when only keyed sessions (or none) are live.
 */
export async function findAnyGroupQuickPlay(
  db: Db,
  gameId: number,
): Promise<number | null> {
  const e = schema.events;
  const i = schema.lfgIntents;
  const keyedHands = db
    .select({ id: i.id })
    .from(i)
    .where(and(eq(i.convertedToEventId, e.id), ne(i.groupKey, '')));
  const rows = await db
    .select({ id: e.id })
    .from(e)
    .where(
      and(liveQuickPlayFilter(eq(e.gameId, gameId)), notExists(keyedHands)),
    )
    .orderBy(desc(e.id));
  return rows[0]?.id ?? null;
}
