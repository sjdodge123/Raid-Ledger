/**
 * ROK-1748 L5b-2: loads what addon-derived quest progress needs for one
 * WoW: Forever event — known quests for its instances (+ chain steps), active
 * signups with characters (D8) and their `char` snapshots. `null` for any
 * non-Forever event, so Classic paths never touch addon data (AC6).
 * ROK-2143 Codex P2 3: known quests carry the kill-switch-aware Blizzard
 * overlay, so an overlay-only Quest Prep card gets completion state too.
 */
import { and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { VARIANT_EXPANSIONS, toDto } from './dungeon-quests.helpers';
import {
  applyKnownQuestOverlay,
  type QuestOverlayDeps,
} from './dungeon-quests.overlay';
import type { DungeonQuestDto } from './dungeon-quests.types';
import {
  buildMembers,
  contentInstanceIds,
  selectEventQuests,
  type EventSignupChar,
  type ForeverEventProgress,
} from './event-forever-progress.helpers';
import type { EffectiveQuests } from './forever-quest-source.helpers';
import { loadForeverQuestSources } from './forever-quest-source.query';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * D8: signups that no longer count toward the event. Mirrors the active-signup
 * filter (`signup-cancel.helpers.ts::buildActiveFilter`) — a `departed` member
 * has left, so their addon snapshot must not feed progress or coverage. No
 * shared exported constant exists in `api/src/events` to reuse.
 */
export const INACTIVE_SIGNUP_STATUSES = ['declined', 'roached_out', 'departed'];

/**
 * Curated quests are seed data; a short memo spares a table read per request.
 * The overlay is applied per call on top, so the kill switch and a fresh
 * import take effect at once.
 */
const KNOWN_QUESTS_TTL_MS = 60_000;
let knownMemo: { at: number; rows: Promise<DungeonQuestDto[]> } | null = null;

/** Drop the curated-quest memo (tests; quest reseeds). */
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

/** Curated quests for the Forever variant (bounded: classic + forever rows). */
async function queryCuratedQuests(db: Db): Promise<DungeonQuestDto[]> {
  const q = schema.wowClassicDungeonQuests;
  const rows = await db
    .select()
    .from(q)
    .where(inArray(q.expansion, VARIANT_EXPANSIONS.wow_forever ?? []));
  return rows.map(toDto);
}

/** {@link queryCuratedQuests}, memoised for {@link KNOWN_QUESTS_TTL_MS}. */
function loadCuratedQuests(db: Db): Promise<DungeonQuestDto[]> {
  const now = Date.now();
  if (knownMemo && now - knownMemo.at < KNOWN_QUESTS_TTL_MS) {
    return knownMemo.rows;
  }
  const rows = queryCuratedQuests(db);
  const entry = { at: now, rows };
  knownMemo = entry;
  rows.catch(() => {
    if (knownMemo === entry) knownMemo = null;
  });
  return rows;
}

/** Curated quests with the Blizzard overlay (switch-aware). */
async function loadKnownQuests(
  deps: QuestOverlayDeps,
): Promise<DungeonQuestDto[]> {
  return applyKnownQuestOverlay(deps, await loadCuratedQuests(deps.db));
}

/** A signup row as selected; null class/race when the character has none. */
interface SignupCharRow {
  userId: number | null;
  characterId: string | null;
  username: string;
  charClass?: string | null | undefined;
  charRace?: string | null | undefined;
}

/** Keep rows with a user and a character, class/race defaulted to null. */
function toSignupChar(r: SignupCharRow): EventSignupChar[] {
  if (r.userId === null || !r.characterId) return [];
  return [
    {
      userId: r.userId,
      characterId: r.characterId,
      username: r.username,
      charClass: r.charClass ?? null,
      charRace: r.charRace ?? null,
    },
  ];
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
      charClass: schema.characters.class,
      charRace: schema.characters.race,
    })
    .from(s)
    .innerJoin(schema.users, eq(schema.users.id, s.userId))
    .leftJoin(schema.characters, eq(schema.characters.id, s.characterId))
    .where(
      and(
        eq(s.eventId, eventId),
        notInArray(s.status, INACTIVE_SIGNUP_STATUSES),
        isNotNull(s.characterId),
        userId === undefined ? undefined : eq(s.userId, userId),
      ),
    );
  return rows.flatMap(toSignupChar);
}

/** Effective quest data (addon snapshot / Armory list) of the signups. */
function loadSnapshots(
  db: Db,
  signups: EventSignupChar[],
): Promise<Map<string, EffectiveQuests>> {
  return loadForeverQuestSources(
    db,
    signups.map((x) => x.characterId),
  );
}

/** Shared body: every active member, or only `userId` when given. */
async function loadProgress(
  deps: QuestOverlayDeps,
  eventId: number,
  userId?: number,
): Promise<ForeverEventProgress | null> {
  const event = await loadForeverEvent(deps.db, eventId);
  if (!event) return null;
  const [known, signups] = await Promise.all([
    loadKnownQuests(deps),
    loadSignupChars(deps.db, eventId, userId),
  ]);
  const snapshots = await loadSnapshots(deps.db, signups);
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
  deps: QuestOverlayDeps,
  eventId: number,
): Promise<ForeverEventProgress | null> {
  return loadProgress(deps, eventId);
}

/**
 * The same context restricted to one member (the PUT path, D5): reads only
 * that user's signed-up character snapshot, not the whole roster's.
 * @returns null when the event is missing or not a Forever event.
 */
export function loadForeverMemberProgress(
  deps: QuestOverlayDeps,
  eventId: number,
  userId: number,
): Promise<ForeverEventProgress | null> {
  return loadProgress(deps, eventId, userId);
}

/**
 * ROK-1911: the event's quest set (instance match + chain steps) for stored
 * `content_instances`, from the same overlaid known-quest read as above.
 */
export async function loadEventQuestSet(
  deps: QuestOverlayDeps,
  contentInstances: unknown,
): Promise<ReturnType<typeof selectEventQuests>> {
  const known = await loadKnownQuests(deps);
  return selectEventQuests(known, contentInstanceIds(contentInstances));
}
