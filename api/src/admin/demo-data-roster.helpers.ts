/**
 * Helper functions for demo data roster assignments and event reassignment.
 * Extracted from DemoDataService to keep file size within ESLint limits.
 */
import { inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { createRng } from './demo-data-generator';
import type { GeneratedEvent } from './demo-data-generator';

type Db = PostgresJsDatabase<typeof schema>;

/** Resolve roster role for a signup based on game type. */
function resolveRosterRole(
  isMMO: boolean,
  characterId: string | null,
  charById: Map<string, { role: string | null }>,
  maxPlayers: number | null,
  playerCount: number,
): string {
  if (isMMO) {
    const char = characterId ? charById.get(characterId) : null;
    return char?.role ?? 'dps';
  }
  if (maxPlayers && playerCount >= maxPlayers) return 'bench';
  return 'player';
}

/** Build max-attendees map from generated events. */
function buildMaxAttendeesMap(
  generatedEvents: GeneratedEvent[],
  genEvents: (typeof schema.events.$inferSelect)[],
): Map<number, number | null> {
  const map = new Map<number, number | null>();
  for (let i = 0; i < generatedEvents.length; i++) {
    const dbEvent = genEvents[i];
    if (dbEvent) map.set(dbEvent.id, generatedEvents[i].maxPlayers);
  }
  return map;
}

/** Group signups by eventId. */
function groupSignupsByEvent(
  signups: (typeof schema.eventSignups.$inferSelect)[],
): Map<number, (typeof schema.eventSignups.$inferSelect)[]> {
  const map = new Map<number, typeof signups>();
  for (const signup of signups) {
    const list = map.get(signup.eventId) ?? [];
    list.push(signup);
    map.set(signup.eventId, list);
  }
  return map;
}

/** Identify MMO game IDs (genre 36). */
function buildMmoGameIds(
  allGames: { id: number; genres: unknown }[],
): Set<number> {
  const ids = new Set<number>();
  for (const g of allGames) {
    if (((g.genres as number[]) ?? []).includes(36)) ids.add(g.id);
  }
  return ids;
}

/** Params for buildRosterValues. */
export interface RosterBuildParams {
  createdSignups: (typeof schema.eventSignups.$inferSelect)[];
  createdEvents: (typeof schema.events.$inferSelect)[];
  createdChars: (typeof schema.characters.$inferSelect)[];
  generatedEvents: GeneratedEvent[];
  genEvents: (typeof schema.events.$inferSelect)[];
  allGames: { id: number; genres: unknown }[];
}

/** Build roster assignment values from signups. */
export function buildRosterValues(
  p: RosterBuildParams,
): Record<string, unknown>[] {
  const charById = new Map(p.createdChars.map((c) => [c.id, c]));
  const maxAtt = buildMaxAttendeesMap(p.generatedEvents, p.genEvents);
  const mmoIds = buildMmoGameIds(p.allGames);
  const evGame = new Map(p.createdEvents.map((ev) => [ev.id, ev.gameId]));
  const slotCounter = new Map<string, number>();
  const values: Record<string, unknown>[] = [];
  for (const [eventId, signups] of groupSignupsByEvent(p.createdSignups)) {
    const gId = evGame.get(eventId);
    const isMMO = gId ? mmoIds.has(gId) : false;
    assignEventRoster(
      signups,
      eventId,
      isMMO,
      maxAtt.get(eventId) ?? null,
      charById,
      slotCounter,
      values,
    );
  }
  return values;
}

/** Assign roster slots for one event's signups. */
function assignEventRoster(
  signups: (typeof schema.eventSignups.$inferSelect)[],
  eventId: number,
  isMMO: boolean,
  maxPlayers: number | null,
  charById: Map<string, { role: string | null }>,
  slotCounter: Map<string, number>,
  values: Record<string, unknown>[],
): void {
  let playerCount = 0;
  for (const signup of signups) {
    const role = resolveRosterRole(
      isMMO,
      signup.characterId,
      charById,
      maxPlayers,
      playerCount,
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

/** Reassign original events to a raid leader user (single query). */
async function reassignOriginalEvents(
  db: Db,
  origEvents: (typeof schema.events.$inferSelect)[],
  raidLeader: { id: number },
): Promise<void> {
  const eventIds = origEvents.slice(0, 2).map((e) => e.id);
  await db
    .update(schema.events)
    .set({ creatorId: raidLeader.id })
    .where(inArray(schema.events.id, eventIds));
}

/** Reassign ~30% of generated events to random non-admin users. */
async function reassignGeneratedEvents(
  db: Db,
  genEvents: (typeof schema.events.$inferSelect)[],
  nonAdminUsers: { id: number }[],
): Promise<void> {
  const rng = createRng(0xeee);
  const reassignByCreator = new Map<number, number[]>();

  for (const event of genEvents) {
    if (rng() < 0.3) {
      const creator = nonAdminUsers[Math.floor(rng() * nonAdminUsers.length)];
      const ids = reassignByCreator.get(creator.id) ?? [];
      ids.push(event.id);
      reassignByCreator.set(creator.id, ids);
    }
  }

  for (const [creatorId, eventIds] of reassignByCreator) {
    await db
      .update(schema.events)
      .set({ creatorId })
      .where(inArray(schema.events.id, eventIds));
  }
}

/** Reassign some events to non-admin creators for variety. */
export async function reassignEventCreators(
  db: Db,
  origEvents: (typeof schema.events.$inferSelect)[],
  genEvents: (typeof schema.events.$inferSelect)[],
  allUsers: { id: number; username: string; role: string }[],
  raidLeaderUsername: string,
): Promise<void> {
  const raidLeader = allUsers.find((u) => u.username === raidLeaderUsername);
  if (raidLeader && origEvents.length >= 2) {
    await reassignOriginalEvents(db, origEvents, raidLeader);
  }

  const nonAdminUsers = allUsers.filter((u) => u.role !== 'admin');
  if (nonAdminUsers.length > 0) {
    await reassignGeneratedEvents(db, genEvents, nonAdminUsers);
  }
}
