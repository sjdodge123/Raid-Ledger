/**
 * Signup and roster installation helpers for demo data.
 * Handles signup creation and roster assignment generation.
 * Extracted from demo-data.service.ts for file size compliance (ROK-719).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  createRng,
  pickN,
  randInt,
  generateSignups,
  generateEvents,
} from './demo-data-generator';
import type { Rng } from './demo-data-generator';

type Db = PostgresJsDatabase<typeof schema>;
type BatchInsert = (
  table: Parameters<Db['insert']>[0],
  rows: Record<string, unknown>[],
  onConflict?: 'doNothing',
) => Promise<void>;
type BatchInsertReturning = (
  table: Parameters<Db['insert']>[0],
  rows: Record<string, unknown>[],
) => Promise<Record<string, unknown>[]>;

/** Deduplicate an array by a key function, keeping first occurrence. */
function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const k = keyFn(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()];
}

/** Group an array by a key function. */
function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

const ROLE_OPTIONS = ['tank', 'healer', 'dps'] as const;

/** Pick 1-2 random preferred roles for a confirmed signup. */
function randomPreferredRoles(rng: Rng): string[] {
  const count = randInt(rng, 1, 2);
  return pickN(rng, ROLE_OPTIONS, count);
}

/** Build event-to-maxAttendees map from generated events. */
function buildMaxAttendeesMap(
  genEvents: { id: number }[],
  generatedEvents: { maxPlayers: number | null }[],
): Map<number, number | null> {
  const map = new Map<number, number | null>();
  for (let i = 0; i < generatedEvents.length; i++) {
    const dbEvent = genEvents[i];
    if (dbEvent) map.set(dbEvent.id, generatedEvents[i].maxPlayers);
  }
  return map;
}

/** Build set of MMO game IDs (genre 36). */
function buildMmoGameIdSet(
  allGames: { id: number; genres: unknown }[],
): Set<number> {
  const set = new Set<number>();
  for (const g of allGames) {
    if (((g.genres as number[]) ?? []).includes(36)) set.add(g.id);
  }
  return set;
}

/** Insert signups for original + generated events. */
export async function installSignups(
  batchInsertReturning: BatchInsertReturning,
  origEvents: (typeof schema.events.$inferSelect)[],
  genEvents: (typeof schema.events.$inferSelect)[],
  allUsers: (typeof schema.users.$inferSelect)[],
  userByName: Map<string, typeof schema.users.$inferSelect>,
  charByUserGame: Map<string, string>,
  generatedSignups: ReturnType<typeof generateSignups>,
) {
  const origSignupValues = buildOrigSignupValues(
    origEvents,
    allUsers,
    charByUserGame,
  );
  const genSignupValues = buildGenSignupValues(
    genEvents,
    userByName,
    charByUserGame,
    generatedSignups,
  );
  const uniqueSignups = dedupeByKey(
    [...origSignupValues, ...genSignupValues],
    (s) => `${String(s.eventId)}:${String(s.userId)}`,
  );
  const createdSignups = (await batchInsertReturning(
    schema.eventSignups,
    uniqueSignups,
  )) as (typeof schema.eventSignups.$inferSelect)[];
  return { createdSignups, uniqueSignups };
}

/** Build a single signup value with optional preferredRoles. */
function buildSignupValue(
  rng: Rng,
  eventId: number,
  userId: number,
  characterId: string | null,
): Record<string, unknown> {
  const isConfirmed = !!characterId;
  return {
    eventId,
    userId,
    characterId,
    confirmationStatus: isConfirmed ? 'confirmed' : 'pending',
    preferredRoles: isConfirmed ? randomPreferredRoles(rng) : null,
  };
}

/** Build original event signup values with random user selection. */
function buildOrigSignupValues(
  origEvents: (typeof schema.events.$inferSelect)[],
  allUsers: (typeof schema.users.$inferSelect)[],
  charByUserGame: Map<string, string>,
): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  for (const event of origEvents) {
    const eventRng = createRng(event.id);
    const numSignups = 3 + Math.floor(eventRng() * 3);
    const gamers = allUsers.slice(1);
    const shuffled = [...gamers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(eventRng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const user of shuffled.slice(0, numSignups)) {
      const charKey = event.gameId ? `${user.id}:${event.gameId}` : null;
      const charId = charKey ? (charByUserGame.get(charKey) ?? null) : null;
      values.push(buildSignupValue(eventRng, event.id, user.id, charId));
    }
  }
  return values;
}

/** Build generated event signup values. */
function buildGenSignupValues(
  genEvents: (typeof schema.events.$inferSelect)[],
  userByName: Map<string, typeof schema.users.$inferSelect>,
  charByUserGame: Map<string, string>,
  generatedSignups: ReturnType<typeof generateSignups>,
): Record<string, unknown>[] {
  const rng = createRng(0xbeef);
  const values: Record<string, unknown>[] = [];
  for (const signup of generatedSignups) {
    const event = genEvents[signup.eventIdx];
    const user = userByName.get(signup.username);
    if (!event || !user) continue;
    const charKey = event.gameId ? `${user.id}:${event.gameId}` : null;
    const charId = charKey ? (charByUserGame.get(charKey) ?? null) : null;
    values.push(buildSignupValue(rng, event.id, user.id, charId));
  }
  return values;
}

/** Insert roster assignments for all signups. */
export async function installRosterAssignments(
  batchInsert: BatchInsert,
  createdSignups: (typeof schema.eventSignups.$inferSelect)[],
  createdChars: (typeof schema.characters.$inferSelect)[],
  createdEvents: (typeof schema.events.$inferSelect)[],
  genEvents: (typeof schema.events.$inferSelect)[],
  generatedEvents: ReturnType<typeof generateEvents>,
  allGames: (typeof schema.games.$inferSelect)[],
): Promise<void> {
  const charById = new Map(createdChars.map((c) => [c.id, c]));
  const eventMaxAttendees = buildMaxAttendeesMap(genEvents, generatedEvents);
  const mmoGameIds = buildMmoGameIdSet(allGames);
  const eventGameId = new Map(createdEvents.map((ev) => [ev.id, ev.gameId]));
  const signupsByEvent = groupBy(createdSignups, (s) => s.eventId);
  const rosterValues = buildRosterValues(
    signupsByEvent,
    charById,
    eventGameId,
    mmoGameIds,
    eventMaxAttendees,
  );
  if (rosterValues.length > 0) {
    await batchInsert(schema.rosterAssignments, rosterValues);
  }
}

/** Build roster assignment values from signups. */
function buildRosterValues(
  signupsByEvent: Map<number, (typeof schema.eventSignups.$inferSelect)[]>,
  charById: Map<string, typeof schema.characters.$inferSelect>,
  eventGameId: Map<number, number | null>,
  mmoGameIds: Set<number>,
  eventMaxAttendees: Map<number, number | null>,
): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  const slotCounter = new Map<string, number>();
  for (const [eventId, signups] of signupsByEvent) {
    const gId = eventGameId.get(eventId);
    const isMMO = gId ? mmoGameIds.has(gId) : false;
    const maxPlayers = eventMaxAttendees.get(eventId) ?? null;
    appendRosterForEvent(
      signups,
      eventId,
      isMMO,
      maxPlayers,
      charById,
      slotCounter,
      values,
    );
  }
  return values;
}

/** Append roster values for a single event's signups. */
function appendRosterForEvent(
  signups: (typeof schema.eventSignups.$inferSelect)[],
  eventId: number,
  isMMO: boolean,
  maxPlayers: number | null,
  charById: Map<string, typeof schema.characters.$inferSelect>,
  slotCounter: Map<string, number>,
  values: Record<string, unknown>[],
): void {
  let playerCount = 0;
  for (const signup of signups) {
    const role = determineRole(
      isMMO,
      maxPlayers,
      playerCount,
      signup,
      charById,
    );
    if (role === 'player') playerCount++;
    const slotKey = `${eventId}:${role}`;
    const position = (slotCounter.get(slotKey) ?? 0) + 1;
    slotCounter.set(slotKey, position);
    values.push({
      eventId: signup.eventId,
      signupId: signup.id,
      role,
      position,
    });
  }
}

/** Determine roster role for a signup. */
function determineRole(
  isMMO: boolean,
  maxPlayers: number | null,
  playerCount: number,
  signup: typeof schema.eventSignups.$inferSelect,
  charById: Map<string, typeof schema.characters.$inferSelect>,
): string {
  if (isMMO) {
    const char = signup.characterId ? charById.get(signup.characterId) : null;
    return char?.role ?? 'dps';
  }
  if (maxPlayers && playerCount >= maxPlayers) return 'bench';
  return 'player';
}
