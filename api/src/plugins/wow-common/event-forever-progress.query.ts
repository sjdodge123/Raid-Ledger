/**
 * ROK-1748 L5b-2: loads what addon-derived quest progress needs for one
 * WoW: Forever event — known quests for its instances (+ chain steps), active
 * signups with characters (D8) and their `char` snapshots. `null` for any
 * non-Forever event, so Classic paths never touch addon data (AC6).
 */
import { and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { VARIANT_EXPANSIONS, toDto } from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';
import {
  buildMembers,
  contentInstanceIds,
  selectEventQuests,
  type EventSignupChar,
  type ForeverEventProgress,
} from './event-forever-progress.helpers';
import { loadForeverCharSnapshots } from './forever-char-snapshot.query';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** D8: the roster's inactive statuses (`signups-roster-query.helpers.ts`). */
export const INACTIVE_SIGNUP_STATUSES = ['declined', 'roached_out'];

/** The event's `content_instances` when it is a Forever event, else null. */
async function loadForeverEvent(
  db: Db,
  eventId: number,
): Promise<{ contentInstances: unknown } | null> {
  const [row] = await db
    .select({
      contentInstances: schema.events.contentInstances,
      slug: schema.games.slug,
    })
    .from(schema.events)
    .leftJoin(schema.games, eq(schema.games.id, schema.events.gameId))
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row?.slug === WOW_FOREVER_GAME_SLUG ? row : null;
}

/** Known quests for the Forever variant (bounded: classic + forever rows). */
async function loadKnownQuests(db: Db): Promise<DungeonQuestDto[]> {
  const q = schema.wowClassicDungeonQuests;
  const rows = await db
    .select()
    .from(q)
    .where(inArray(q.expansion, VARIANT_EXPANSIONS.wow_forever ?? []));
  return rows.map(toDto);
}

/** Active signups (D8) that carry a character. */
async function loadSignupChars(
  db: Db,
  eventId: number,
): Promise<EventSignupChar[]> {
  const s = schema.eventSignups;
  const rows = await db
    .select({
      userId: s.userId,
      characterId: s.characterId,
      username: schema.users.username,
    })
    .from(s)
    .innerJoin(schema.users, eq(schema.users.id, s.userId))
    .where(
      and(
        eq(s.eventId, eventId),
        notInArray(s.status, INACTIVE_SIGNUP_STATUSES),
        isNotNull(s.characterId),
      ),
    );
  return rows.flatMap(({ userId, characterId, username }) =>
    userId !== null && characterId ? [{ userId, characterId, username }] : [],
  );
}

/**
 * Load the Forever progress context for an event.
 * @returns null when the event is missing or not a Forever event.
 */
export async function loadForeverEventProgress(
  db: Db,
  eventId: number,
): Promise<ForeverEventProgress | null> {
  const event = await loadForeverEvent(db, eventId);
  if (!event) return null;
  const [known, signups] = await Promise.all([
    loadKnownQuests(db),
    loadSignupChars(db, eventId),
  ]);
  const ids = signups.map((x) => x.characterId);
  const snapshots = await loadForeverCharSnapshots(db, ids);
  const instanceIds = contentInstanceIds(event.contentInstances);
  return {
    ...selectEventQuests(known, instanceIds),
    members: buildMembers(signups, snapshots),
  };
}
