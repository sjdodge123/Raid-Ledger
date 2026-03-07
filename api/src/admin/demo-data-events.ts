/**
 * Demo Data — event definitions.
 * Extracted from demo-data.constants.ts for file size compliance.
 */

/** Helper: round a Date to the start of its hour */
function roundToHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

interface GameEntry {
  id: number;
  slug: string;
}

type TimeFn = (n: number) => Date;
type GameKey = 'wow' | 'valheim' | 'ffxiv';

/** Raw event template: [title, description, gameKey, startOffset, durationHours, useDays]. */
type EventTuple = [string, string, GameKey, number, number, boolean];

const EVENT_TUPLES: EventTuple[] = [
  [
    'Heroic Amirdrassil Clear',
    'Weekly heroic raid run. All welcome! BE-only pulls.',
    'wow',
    -1,
    3,
    false,
  ],
  [
    'Mythic+ Push Night',
    'High key pushing session. Need 2 DPS, 1 tank.',
    'wow',
    2,
    3,
    false,
  ],
  [
    'Valheim Boss Rush',
    'Taking down all bosses in one session!',
    'valheim',
    1,
    3,
    true,
  ],
  [
    'FFXIV Savage Prog',
    'M4S progression - Phase 2 onwards. Know the fight!',
    'ffxiv',
    3,
    3,
    true,
  ],
  [
    'Morning Dungeon Runs',
    'Casual dungeon runs for alts.',
    'wow',
    -4,
    2,
    false,
  ],
  [
    'Late Night Raids',
    'For the night owls. Normal mode farm.',
    'wow',
    6,
    3,
    false,
  ],
];

/** Build the list of event templates from raw tuples. */
function buildEventList(
  gameIds: Record<GameKey, number | null>,
  hoursFromNow: TimeFn,
  daysFromNow: TimeFn,
) {
  return EVENT_TUPLES.map(([title, description, key, offset, dur, useDays]) => {
    const fn = useDays ? daysFromNow : hoursFromNow;
    const startTime = fn(offset);
    const endTime = useDays
      ? new Date(startTime.getTime() + dur * 60 * 60 * 1000)
      : hoursFromNow(offset + dur);
    return { title, description, gameId: gameIds[key], startTime, endTime };
  });
}

/** Generate event definitions (time-relative, needs games table IDs) */
export function getEventsDefinitions(games: GameEntry[]) {
  const gameIds: Record<GameKey, number | null> = {
    wow: games.find((g) => g.slug === 'world-of-warcraft')?.id ?? null,
    valheim: games.find((g) => g.slug === 'valheim')?.id ?? null,
    ffxiv: games.find((g) => g.slug === 'final-fantasy-xiv-online')?.id ?? null,
  };
  const now = new Date();
  const baseHour = roundToHour(now);
  const hoursFromNow = (hours: number) =>
    new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
  const daysFromNow = (days: number) =>
    new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

  return buildEventList(gameIds, hoursFromNow, daysFromNow);
}
