/**
 * Demo data generation steps (pure data generation, no DB access).
 */
import * as schema from '../drizzle/schema';
import { FAKE_GAMERS, ORIGINAL_GAMER_COUNT } from './demo-data.constants';
import {
  generateEvents,
  generateCharacters,
  generateSignups,
  generateGameTime,
  generateAvailability,
  generateNotifications,
  generateNotifPreferences,
  generateGameInterests,
} from './demo-data-generator';

type GameRow = typeof schema.games.$inferSelect;

/** Build IGDB ID to max player count map. */
function buildPlayerCountMap(allGames: GameRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of allGames) {
    const pc = g.playerCount as { min: number; max: number } | null;
    if (pc?.max) map.set(String(g.igdbId), pc.max);
  }
  return map;
}

/** Generate core entity data (events, characters, signups). */
function generateCoreData(rng: () => number, allGames: GameRow[], now: Date) {
  const igdbPlayerCounts = buildPlayerCountMap(allGames);
  const events = generateEvents(rng, allGames, now, igdbPlayerCounts);
  const usernames = FAKE_GAMERS.map((g) => g.username);
  const newUsernames = usernames.slice(ORIGINAL_GAMER_COUNT);
  const chars = generateCharacters(rng, newUsernames);
  const signups = generateSignups(
    rng,
    events,
    [...usernames, 'SeedAdmin'],
    chars,
    allGames,
  );
  return { events, chars, signups, usernames, newUsernames };
}

/** Generate support data (game time, availability, notifications, etc). */
function generateSupportData(
  rng: () => number,
  usernames: string[],
  newUsernames: string[],
  events: ReturnType<typeof generateEvents>,
  allGames: GameRow[],
  now: Date,
) {
  const gameTime = generateGameTime(rng, newUsernames);
  const avail = generateAvailability(rng, newUsernames, now);
  const notifs = generateNotifications(rng, usernames, events, now);
  const notifPrefs = generateNotifPreferences(rng, usernames);
  const allIgdbIds = allGames
    .map((g) => g.igdbId)
    .filter((id): id is number => id !== null);
  const interests = generateGameInterests(rng, usernames, allIgdbIds);
  return { gameTime, avail, notifs, notifPrefs, interests };
}

/** Generate all non-DB data structures. */
export function generateAllData(
  rng: () => number,
  allGames: GameRow[],
  now: Date,
) {
  const core = generateCoreData(rng, allGames, now);
  const support = generateSupportData(
    rng,
    core.usernames,
    core.newUsernames,
    core.events,
    allGames,
    now,
  );
  return { ...core, ...support };
}
