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

/** Edge-case event definition with optional extra fields. */
export interface EdgeCaseEvent {
  title: string;
  description: string;
  gameId: number | null;
  startTime: Date;
  endTime: Date;
  isAdHoc?: boolean;
  adHocStatus?: string;
  cancelledAt?: Date;
  cancellationReason?: string;
}

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

/** Build edge-case events for testing (ad-hoc, cancelled, no-game). */
function buildEdgeCaseEvents(
  gameIds: Record<GameKey, number | null>,
  hoursFromNow: TimeFn,
): EdgeCaseEvent[] {
  return [
    {
      title: 'Impromptu Helldivers Run',
      description: 'Spontaneous bug-stomping session!',
      gameId: gameIds.valheim,
      startTime: hoursFromNow(-1),
      endTime: hoursFromNow(2),
      isAdHoc: true,
      adHocStatus: 'live',
    },
    {
      title: 'Late Night Warframe Session',
      description: 'Chill relic cracking — already wrapped up.',
      gameId: gameIds.ffxiv,
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-2),
      isAdHoc: true,
      adHocStatus: 'ended',
    },
    {
      title: 'Cancelled Mythic Prog',
      description: 'Was supposed to be M3S prog night.',
      gameId: gameIds.wow,
      startTime: hoursFromNow(8),
      endTime: hoursFromNow(11),
      cancelledAt: new Date(),
      cancellationReason: 'Not enough signups',
    },
    {
      title: 'Community Game Night',
      description: 'Social hangout — no specific game, just vibes.',
      gameId: null,
      startTime: hoursFromNow(4),
      endTime: hoursFromNow(7),
    },
  ];
}

/** Build gameIds lookup from game rows. */
function resolveGameIds(games: GameEntry[]): Record<GameKey, number | null> {
  return {
    wow: games.find((g) => g.slug === 'world-of-warcraft')?.id ?? null,
    valheim: games.find((g) => g.slug === 'valheim')?.id ?? null,
    ffxiv: games.find((g) => g.slug === 'final-fantasy-xiv-online')?.id ?? null,
  };
}

/** Build hoursFromNow / daysFromNow helpers from the current time. */
function buildTimeFns() {
  const baseHour = roundToHour(new Date());
  const hoursFromNow = (h: number) =>
    new Date(baseHour.getTime() + h * 60 * 60 * 1000);
  const daysFromNow = (d: number) =>
    new Date(baseHour.getTime() + d * 24 * 60 * 60 * 1000);
  return { hoursFromNow, daysFromNow };
}

/** Generate event definitions (time-relative, needs games table IDs) */
export function getEventsDefinitions(games: GameEntry[]) {
  const gameIds = resolveGameIds(games);
  const { hoursFromNow, daysFromNow } = buildTimeFns();
  return buildEventList(gameIds, hoursFromNow, daysFromNow);
}

/** Generate edge-case event definitions (ad-hoc, cancelled, no-game). */
export function getEdgeCaseDefinitions(games: GameEntry[]): EdgeCaseEvent[] {
  const gameIds = resolveGameIds(games);
  const { hoursFromNow } = buildTimeFns();
  return buildEdgeCaseEvents(gameIds, hoursFromNow);
}
