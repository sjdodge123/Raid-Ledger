/**
 * Helper functions for demo data installation.
 * Extracted from DemoDataService to keep file size within ESLint limits.
 */
import * as schema from '../drizzle/schema';
import { createRng } from './demo-data-generator';
import type { GeneratedCharacter } from './demo-data-generator';

/** Build a single character insert value. */
function buildCharValue(
  userId: number,
  gameId: number,
  charData: {
    charName: string;
    class: string;
    spec: string;
    role: string;
    wowClass: string;
  },
  isMain: boolean,
  getClassIconUrl: (wowClass: string) => string,
): Record<string, unknown> {
  return {
    userId,
    gameId,
    name: charData.charName,
    class: charData.class,
    spec: charData.spec,
    role: charData.role,
    isMain,
    avatarUrl: getClassIconUrl(charData.wowClass),
    displayOrder: isMain ? 0 : 1,
  };
}

/** Build original character insert values from CHARACTERS_CONFIG. */
export function buildOriginalCharValues(
  charConfig: readonly {
    username: string;
    gameIdx: number;
    charName: string;
    class: string;
    spec: string;
    role: string;
    wowClass: string;
  }[],
  userByName: Map<string, { id: number }>,
  allGames: { id: number }[],
  getClassIconUrl: (wowClass: string) => string,
): Record<string, unknown>[] {
  const usersWithMain = new Set<string>();
  const values: Record<string, unknown>[] = [];
  for (const charData of charConfig) {
    const user = userByName.get(charData.username);
    const game = allGames[charData.gameIdx];
    if (!user || !game) continue;
    const isMain = !usersWithMain.has(`${charData.username}:${game.id}`);
    usersWithMain.add(`${charData.username}:${game.id}`);
    values.push(
      buildCharValue(user.id, game.id, charData, isMain, getClassIconUrl),
    );
  }
  return values;
}

/** Build generated character insert values. */
export function buildGeneratedCharValues(
  generatedChars: GeneratedCharacter[],
  userByName: Map<string, { id: number }>,
  gamesBySlug: Map<string, { id: number }>,
  getClassIconUrl: (wowClass: string) => string,
): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  for (const c of generatedChars) {
    const user = userByName.get(c.username);
    const game = gamesBySlug.get(c.gameSlug);
    if (!user || !game) continue;
    values.push({
      userId: user.id,
      gameId: game.id,
      name: c.charName,
      class: c.class,
      spec: c.spec,
      role: c.role,
      isMain: c.isMain,
      avatarUrl: c.wowClass ? getClassIconUrl(c.wowClass) : null,
      displayOrder: c.isMain ? 0 : 1,
    });
  }
  return values;
}

/** Build original event signup values using seeded PRNG. */
export function buildOriginalSignupValues(
  origEvents: (typeof schema.events.$inferSelect)[],
  allUsers: { id: number; role: string }[],
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
      const characterId = charKey
        ? (charByUserGame.get(charKey) ?? null)
        : null;
      values.push({
        eventId: event.id,
        userId: user.id,
        characterId,
        confirmationStatus: characterId ? 'confirmed' : 'pending',
      });
    }
  }
  return values;
}

/** Build generated event signup values. */
export function buildGeneratedSignupValues(
  generatedSignups: { eventIdx: number; username: string }[],
  genEvents: (typeof schema.events.$inferSelect)[],
  userByName: Map<string, { id: number }>,
  charByUserGame: Map<string, string>,
): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  for (const signup of generatedSignups) {
    const event = genEvents[signup.eventIdx];
    const user = userByName.get(signup.username);
    if (!event || !user) continue;
    const charKey = event.gameId ? `${user.id}:${event.gameId}` : null;
    const characterId = charKey ? (charByUserGame.get(charKey) ?? null) : null;
    values.push({
      eventId: event.id,
      userId: user.id,
      characterId,
      confirmationStatus: characterId ? 'confirmed' : 'pending',
    });
  }
  return values;
}

/** Deduplicate records by a composite key function. */
export function dedupeByKey<T>(records: T[], keyFn: (r: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const r of records) {
    const key = keyFn(r);
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

/** Map availability definitions to insert values. */
export function mapAvailValues(
  defs: { username: string; start: Date; end: Date; status: string }[],
  userByName: Map<string, { id: number }>,
): Record<string, unknown>[] {
  return defs
    .map((a) => {
      const user = userByName.get(a.username);
      if (!user) return null;
      return {
        userId: user.id,
        timeRange: [a.start, a.end] as [Date, Date],
        status: a.status,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
}

/** Map game time definitions to insert values with dedup. */
export function mapAndDedupeGameTime(
  origDefs: { username: string; dayOfWeek: number; startHour: number }[],
  genDefs: { username: string; dayOfWeek: number; startHour: number }[],
  userByName: Map<string, { id: number }>,
): Record<string, unknown>[] {
  const mapSlot = (slot: (typeof origDefs)[0]) => {
    const user = userByName.get(slot.username);
    if (!user) return null;
    return {
      userId: user.id,
      dayOfWeek: slot.dayOfWeek,
      startHour: slot.startHour,
    };
  };
  const all = [...origDefs, ...genDefs]
    .map(mapSlot)
    .filter((v): v is NonNullable<typeof v> => v !== null);
  return dedupeByKey(
    all,
    (gt) => `${gt.userId}:${gt.dayOfWeek}:${gt.startHour}`,
  );
}

/** Map notification values for generated notifications. */
export function mapNotifValues(
  notifs: {
    username: string;
    type: string;
    title: string;
    message: string;
    payload: Record<string, unknown>;
    createdAt: Date;
    readAt: Date | null;
  }[],
  userByName: Map<string, { id: number }>,
): Record<string, unknown>[] {
  return notifs
    .map((n) => {
      const user = userByName.get(n.username);
      if (!user) return null;
      return {
        userId: user.id,
        type: n.type,
        title: n.title,
        message: n.message,
        payload: n.payload,
        createdAt: n.createdAt,
        readAt: n.readAt,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
}

/** Map game interest values with dedup. */
export function mapAndDedupeInterests(
  interests: { username: string; igdbId: number }[],
  userByName: Map<string, { id: number }>,
  igdbIdsByDbId: Map<number | null, number>,
): Record<string, unknown>[] {
  const values = interests
    .map((gi) => {
      const user = userByName.get(gi.username);
      const gameDbId = igdbIdsByDbId.get(gi.igdbId);
      if (!user || !gameDbId) return null;
      return { userId: user.id, gameId: gameDbId };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
  return dedupeByKey(values, (gi) => `${gi.userId}:${gi.gameId}`);
}
