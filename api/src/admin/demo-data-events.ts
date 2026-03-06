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

/** Generate event definitions (time-relative, needs games table IDs) */
export function getEventsDefinitions(games: GameEntry[]) {
  const wowGame = games.find((g) => g.slug === 'world-of-warcraft');
  const valheimGame = games.find((g) => g.slug === 'valheim');
  const ffxivGame = games.find((g) => g.slug === 'final-fantasy-xiv-online');

  const now = new Date();
  const baseHour = roundToHour(now);
  const hoursFromNow = (hours: number) =>
    new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
  const daysFromNow = (days: number) =>
    new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

  return [
    {
      title: 'Heroic Amirdrassil Clear',
      description: 'Weekly heroic raid run. All welcome! BE-only pulls.',
      gameId: wowGame?.id ?? null,
      startTime: hoursFromNow(-1),
      endTime: hoursFromNow(2),
    },
    {
      title: 'Mythic+ Push Night',
      description: 'High key pushing session. Need 2 DPS, 1 tank.',
      gameId: wowGame?.id ?? null,
      startTime: hoursFromNow(2),
      endTime: hoursFromNow(5),
    },
    {
      title: 'Valheim Boss Rush',
      description: 'Taking down all bosses in one session!',
      gameId: valheimGame?.id ?? null,
      startTime: daysFromNow(1),
      endTime: new Date(daysFromNow(1).getTime() + 3 * 60 * 60 * 1000),
    },
    {
      title: 'FFXIV Savage Prog',
      description: 'M4S progression - Phase 2 onwards. Know the fight!',
      gameId: ffxivGame?.id ?? null,
      startTime: daysFromNow(3),
      endTime: new Date(daysFromNow(3).getTime() + 3 * 60 * 60 * 1000),
    },
    {
      title: 'Morning Dungeon Runs',
      description: 'Casual dungeon runs for alts.',
      gameId: wowGame?.id ?? null,
      startTime: hoursFromNow(-4),
      endTime: hoursFromNow(-2),
    },
    {
      title: 'Late Night Raids',
      description: 'For the night owls. Normal mode farm.',
      gameId: wowGame?.id ?? null,
      startTime: hoursFromNow(6),
      endTime: hoursFromNow(9),
    },
  ];
}
