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
import {
  loadForeverCharSnapshot,
  loadForeverCharSnapshots,
  type CharSnapshot,
} from './forever-char-snapshot.query';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * D8: signups that no longer count toward the event. Mirrors the active-signup
 * filter (`signup-cancel.helpers.ts::buildActiveFilter`) — a `departed` member
 * has left, so their addon snapshot must not feed progress or coverage. No
 * shared exported constant exists in `api/src/events` to reuse.
 */
export const INACTIVE_SIGNUP_STATUSES = ['declined', 'roached_out', 'departed'];

/** Known quests are seed data; a short memo spares a table read per request. */
const KNOWN_QUESTS_TTL_MS = 60_000;
let knownMemo: { at: number; rows: Promise<DungeonQuestDto[]> } | null = null;

/** Drop the known-quest memo (tests; quest reseeds). */
export function clearKnownQuestMemo(): void {
  knownMemo = null;
}

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
async function queryKnownQuests(db: Db): Promise<DungeonQuestDto[]> {
  const q = schema.wowClassicDungeonQuests;
  const rows = await db
    .select()
    .from(q)
    .where(inArray(q.expansion, VARIANT_EXPANSIONS.wow_forever ?? []));
  return rows.map(toDto);
}

/** {@link queryKnownQuests}, memoised for {@link KNOWN_QUESTS_TTL_MS}. */
function loadKnownQuests(db: Db): Promise<DungeonQuestDto[]> {
  const now = Date.now();
  if (knownMemo && now - knownMemo.at < KNOWN_QUESTS_TTL_MS) {
    return knownMemo.rows;
  }
  const rows = queryKnownQuests(db);
  const entry = { at: now, rows };
  knownMemo = entry;
  rows.catch(() => {
    if (knownMemo === entry) knownMemo = null;
  });
  return rows;
}

/** Active signups (D8) that carry a character. */
async function loadSignupChars(
  db: Db,
  eventId: number,
  userId?: number,
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
        userId === undefined ? undefined : eq(s.userId, userId),
      ),
    );
  return rows.flatMap(({ userId, characterId, username }) =>
    userId !== null && characterId ? [{ userId, characterId, username }] : [],
  );
}

/** One user's snapshot via the single loader; everyone's via the batch. */
async function loadSnapshots(
  db: Db,
  signups: EventSignupChar[],
  single: boolean,
): Promise<Map<string, CharSnapshot>> {
  if (!single) {
    return loadForeverCharSnapshots(
      db,
      signups.map((x) => x.characterId),
    );
  }
  const [one] = signups;
  const snap = one ? await loadForeverCharSnapshot(db, one.characterId) : null;
  return new Map(one && snap ? [[one.characterId, snap]] : []);
}

/** Shared body: every active member, or only `userId` when given. */
async function loadProgress(
  db: Db,
  eventId: number,
  userId?: number,
): Promise<ForeverEventProgress | null> {
  const event = await loadForeverEvent(db, eventId);
  if (!event) return null;
  const [known, signups] = await Promise.all([
    loadKnownQuests(db),
    loadSignupChars(db, eventId, userId),
  ]);
  const snapshots = await loadSnapshots(db, signups, userId !== undefined);
  const instanceIds = contentInstanceIds(event.contentInstances);
  return {
    ...selectEventQuests(known, instanceIds),
    members: buildMembers(signups, snapshots),
  };
}

/**
 * Load the Forever progress context for an event.
 * @returns null when the event is missing or not a Forever event.
 */
export function loadForeverEventProgress(
  db: Db,
  eventId: number,
): Promise<ForeverEventProgress | null> {
  return loadProgress(db, eventId);
}

/**
 * The same context restricted to one member (the PUT path, D5): reads only
 * that user's signed-up character snapshot, not the whole roster's.
 * @returns null when the event is missing or not a Forever event.
 */
export function loadForeverMemberProgress(
  db: Db,
  eventId: number,
  userId: number,
): Promise<ForeverEventProgress | null> {
  return loadProgress(db, eventId, userId);
}
