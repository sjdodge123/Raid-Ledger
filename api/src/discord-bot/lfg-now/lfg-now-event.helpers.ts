/**
 * Insert values for an LFG-born "playing now" event (ROK-1494 D7).
 *
 * A sibling of `createAdHocEventRow` rather than a widening of it:
 * that function takes `bindingId: string` as a REQUIRED positional and writes
 * it unconditionally, and an LFG-born event has no channel binding at all.
 * Widening it would touch Quick Play's spawn path for no benefit.
 *
 * Three differences from `buildAdHocEventValues`:
 *   `channelBindingId: null`  — the provenance discriminator (D2),
 *   `ephemeralVoiceEnabled: true` / `privateVoice: false` — public temp voice,
 *     and the per-event row an admin already sees is Q2's "reason in the event",
 *   the title suffix.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  LFG_NOW_EVENT_DURATION_MINUTES,
  LFG_NOW_FALLBACK_GAME_NAME,
  LFG_NOW_TITLE_SUFFIX,
} from './lfg-now.constants';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Build the insert values for a spawned now-session.
 *
 * @param title - Event title, already resolved.
 * @param gameId - Game the group formed on.
 * @param creatorId - Host: the EARLIEST live now-hand.
 * @param now - Start instant; the session runs one hour from here.
 * @returns Drizzle insert values for `events`.
 */
export function buildLfgNowEventValues(
  title: string,
  gameId: number,
  creatorId: number,
  now: Date,
): typeof schema.events.$inferInsert {
  return {
    title,
    gameId,
    creatorId,
    duration: [
      now,
      new Date(now.getTime() + LFG_NOW_EVENT_DURATION_MINUTES * 60 * 1000),
    ],
    slotConfig: { type: 'generic', player: 25, bench: 10 },
    maxAttendees: null,
    isAdHoc: true,
    adHocStatus: 'live',
    channelBindingId: null,
    ephemeralVoiceEnabled: true,
    privateVoice: false,
    reminder15min: false,
    reminder1hour: false,
    reminder24hour: false,
  };
}

/**
 * Resolve a game's name for the event title.
 *
 * @param db - Drizzle handle (must be the spawn transaction).
 * @param gameId - Game the group formed on.
 * @returns `${gameName} — Playing now`.
 */
export async function buildLfgNowTitle(
  db: Db,
  gameId: number,
): Promise<string> {
  const [game] = await db
    .select({ name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  const name = game?.name ?? LFG_NOW_FALLBACK_GAME_NAME;
  return `${name} — ${LFG_NOW_TITLE_SUFFIX}`;
}

/**
 * Insert the spawned event and return its id.
 *
 * @param db - Drizzle handle (must be the spawn transaction).
 * @param gameId - Game the group formed on.
 * @param creatorId - Host: the earliest live now-hand.
 * @param now - Start instant.
 * @returns The new event's id.
 */
export async function createLfgNowEventRow(
  db: Db,
  gameId: number,
  creatorId: number,
  now: Date = new Date(),
): Promise<number> {
  const title = await buildLfgNowTitle(db, gameId);
  const [event] = await db
    .insert(schema.events)
    .values(buildLfgNowEventValues(title, gameId, creatorId, now))
    .returning({ id: schema.events.id });
  return event.id;
}
