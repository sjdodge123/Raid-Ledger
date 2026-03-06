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

/** Generate availability definitions (time-relative) */
export function getAvailabilityDefinitions(): {
  username: string;
  start: Date;
  end: Date;
  status: 'available' | 'blocked';
}[] {
  const now = new Date();
  const baseHour = roundToHour(now);

  const hoursFromNow = (hours: number) =>
    new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
  const daysFromNow = (days: number) =>
    new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

  return [
    { username: 'ShadowMage', start: hoursFromNow(-2), end: hoursFromNow(4), status: 'available' },
    { username: 'DragonSlayer99', start: hoursFromNow(-1), end: hoursFromNow(6), status: 'available' },
    { username: 'HealzForDayz', start: hoursFromNow(0), end: hoursFromNow(3), status: 'available' },
    { username: 'TankMaster', start: hoursFromNow(-3), end: hoursFromNow(5), status: 'available' },
    { username: 'ProRaider', start: hoursFromNow(1), end: hoursFromNow(8), status: 'available' },
    { username: 'HealzForDayz', start: hoursFromNow(3), end: hoursFromNow(6), status: 'blocked' },
    { username: 'CasualCarl', start: hoursFromNow(-1), end: hoursFromNow(2), status: 'blocked' },
    { username: 'NightOwlGamer', start: hoursFromNow(0), end: hoursFromNow(4), status: 'blocked' },
    { username: 'DragonSlayer99', start: daysFromNow(2), end: daysFromNow(4), status: 'blocked' },
    { username: 'TankMaster', start: daysFromNow(5), end: daysFromNow(7), status: 'blocked' },
  ];
}
