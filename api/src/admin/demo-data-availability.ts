/**
 * Demo Data — availability definitions.
 * Extracted from demo-data.constants.ts for file size compliance.
 */

/** Helper: round a Date to the start of its hour */
function roundToHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

type AvailabilityDef = {
  username: string;
  start: Date;
  end: Date;
  status: 'available' | 'blocked';
};

/** Raw slot tuples: [username, startOffset, endOffset]. */
const AVAILABLE_TUPLES: [string, number, number][] = [
  ['ShadowMage', -2, 4],
  ['DragonSlayer99', -1, 6],
  ['HealzForDayz', 0, 3],
  ['TankMaster', -3, 5],
  ['ProRaider', 1, 8],
];

/** Build the "available" slots relative to the given base hour. */
function buildAvailableSlots(
  hoursFromNow: (h: number) => Date,
): AvailabilityDef[] {
  return AVAILABLE_TUPLES.map(([username, s, e]) => ({
    username,
    start: hoursFromNow(s),
    end: hoursFromNow(e),
    status: 'available' as const,
  }));
}

type TimeFn = (n: number) => Date;

/** Raw blocked tuples: [username, startOffset, endOffset, useHours]. */
const BLOCKED_TUPLES: [string, number, number, boolean][] = [
  ['HealzForDayz', 3, 6, true],
  ['CasualCarl', -1, 2, true],
  ['NightOwlGamer', 0, 4, true],
  ['DragonSlayer99', 2, 4, false],
  ['TankMaster', 5, 7, false],
];

/** Build the "blocked" slots relative to the given base hour. */
function buildBlockedSlots(
  hoursFromNow: TimeFn,
  daysFromNow: TimeFn,
): AvailabilityDef[] {
  return BLOCKED_TUPLES.map(([username, s, e, useHours]) => ({
    username,
    start: (useHours ? hoursFromNow : daysFromNow)(s),
    end: (useHours ? hoursFromNow : daysFromNow)(e),
    status: 'blocked' as const,
  }));
}

/** Generate availability definitions (time-relative) */
export function getAvailabilityDefinitions(): AvailabilityDef[] {
  const now = new Date();
  const baseHour = roundToHour(now);

  const hoursFromNow = (hours: number) =>
    new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
  const daysFromNow = (days: number) =>
    new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

  return [
    ...buildAvailableSlots(hoursFromNow),
    ...buildBlockedSlots(hoursFromNow, daysFromNow),
  ];
}
