/**
 * ROK-2187 — pure scheduling helpers for the GG <year> delivery job: the
 * default delivery day (Q1), the date/hour gate, the DM offset (R7) and the
 * year-scoped announcement dedup key.
 */
import { zonedParts } from '../../../notifications/weekly-digest-schedule.helpers';

/** The announcement dedup key lives ~400 days: one post per year, ever. */
export const GG_ANNOUNCE_TTL_SECONDS = 400 * 24 * 60 * 60;

/** Default delivery hour, community time (Q1). */
export const GG_DEFAULT_DELIVERY_HOUR = 18;

/** Default minutes between the announcement and the first DM (R7). */
export const GG_DEFAULT_DM_OFFSET_MINUTES = 15;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `NotificationDedupService` key for `year`'s channel announcement. */
export function ggAnnounceKey(year: number): string {
  return `gg:${year}:announce`;
}

/**
 * Monday of December's second week (Q1): the Monday of the Mon–Sun week that
 * contains December 8th (week one is the week holding December 1st).
 */
export function defaultGgDeliveryDate(year: number): string {
  const dec8 = new Date(Date.UTC(year, 11, 8)).getUTCDay();
  const day = 8 - ((dec8 + 6) % 7);
  return `${year}-12-${String(day).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → its numeric parts, or null when malformed. */
export function parseGgDate(
  raw: string | null | undefined,
): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(raw?.trim() ?? '');
  if (!match) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * The delivery date in force for `currentYear` (community tz). A stored date
 * from an EARLIER year is treated as unset — the admin panel saves the whole
 * draft, so last year's explicit date must not pin delivery to a past year
 * and silently skip every later December. A malformed value falls back too.
 */
export function effectiveGgDeliveryDate(
  stored: string | null | undefined,
  currentYear: number,
): string {
  const parsed = parseGgDate(stored);
  if (!parsed || parsed.year < currentYear) {
    return defaultGgDeliveryDate(currentYear);
  }
  return (stored ?? '').trim();
}

/**
 * True when `now`, read in `timeZone`, is at or after `date` `hour`:00 AND
 * still in that calendar year — so a stale stored date never fires in
 * January, and a tick that missed the hour (bot offline) catches up later.
 */
export function isGgDeliveryDue(
  now: Date,
  date: string,
  hour: number,
  timeZone: string,
): boolean {
  const target = parseGgDate(date);
  if (!target) return false;
  const local = zonedParts(now, timeZone);
  if (local.year !== target.year) return false;
  const nowKey = [local.month, local.day, local.hour];
  const dueKey = [target.month, target.day, hour];
  for (let i = 0; i < nowKey.length; i += 1) {
    const a = nowKey[i] ?? 0;
    const b = dueKey[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/** True once `offsetMinutes` have passed since the announcement (AC3). */
export function isGgDmWaveOpen(
  now: Date,
  announcedAt: Date,
  offsetMinutes: number,
): boolean {
  return now.getTime() >= announcedAt.getTime() + offsetMinutes * 60_000;
}
