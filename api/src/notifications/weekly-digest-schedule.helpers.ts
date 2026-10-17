/**
 * Weekly digest scheduling — pure helpers (ROK-1435 slice L4, spec §5).
 *
 * The cron ticks hourly; these decide whether a tick may post (operator
 * ruling 1b: configurable day + hour in the community timezone — any tick
 * from that hour to the end of that local day), which ISO
 * week it belongs to (the dedup key), and which channel the post goes to
 * (ruling 3b: dedicated channel, falling back to the bot's default).
 */

/** SchedulerRegistry / cron-jobs admin name. */
export const DIGEST_JOB_NAME = 'WeeklyDigestService_postDigest';

/** Slightly over a week: self-cleaning, never two digests in one week. */
export const DIGEST_DEDUP_TTL_SECONDS = 8 * 24 * 3600;

/** Monday. */
export const DEFAULT_DIGEST_DAY = 1;
export const DEFAULT_DIGEST_HOUR = 9;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DigestSlot {
  /** 0 (Sunday) – 6 (Saturday). */
  day: number;
  /** 0 – 23. */
  hour: number;
}

/** Local calendar parts of `now` in `timeZone`. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
}

function parseBounded(
  raw: string | null | undefined,
  max: number,
  fallback: number,
): number {
  if (raw == null || !/^\d{1,2}$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return n <= max ? n : fallback;
}

/** Settings strings → a slot; junk or unset falls back to Monday 09:00. */
export function parseDigestSlot(
  dayRaw: string | null | undefined,
  hourRaw: string | null | undefined,
): DigestSlot {
  return {
    day: parseBounded(dayRaw, 6, DEFAULT_DIGEST_DAY),
    hour: parseBounded(hourRaw, 23, DEFAULT_DIGEST_HOUR),
  };
}

/** A usable IANA zone, or UTC when the configured one is unset or bogus. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** Break `now` into local calendar parts in `timeZone`. */
export function zonedParts(now: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAYS.indexOf(get('weekday') ?? ''),
    hour: Number(get('hour')) % 24,
  };
}

/**
 * True when `now`, read in `timeZone`, is on the configured day at or after
 * the configured hour — the window runs to local midnight. A tick that skips
 * (bot offline, send failed and the claim was released, nothing to say) is
 * therefore retried on every later tick that day; the ISO-week dedup key
 * keeps it to one post. It also covers a DST spring-forward day on which the
 * slot hour does not exist locally: the first tick after the gap opens it.
 */
export function isDigestSlot(
  now: Date,
  slot: DigestSlot,
  timeZone: string,
): boolean {
  const local = zonedParts(now, timeZone);
  return local.weekday === slot.day && local.hour >= slot.hour;
}

/** ISO-8601 week-numbering year and week of `now`'s local date. */
export function isoWeek(
  now: Date,
  timeZone: string,
): { year: number; week: number } {
  const local = zonedParts(now, timeZone);
  const date = Date.UTC(local.year, local.month - 1, local.day);
  const mondayBased = (new Date(date).getUTCDay() + 6) % 7;
  const thursday = new Date(date + (3 - mondayBased) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const dayOfYear = (thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS;
  return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

/** `weekly-digest:2026-W39` — changes exactly when the local ISO week does. */
export function digestDedupKey(now: Date, timeZone: string): string {
  const { year, week } = isoWeek(now, timeZone);
  return `weekly-digest:${year}-W${String(week).padStart(2, '0')}`;
}

/** Dedicated digest channel first, the bot's default channel second. */
export function resolveDigestChannel(
  dedicated: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const pick = dedicated?.trim() || fallback?.trim();
  return pick ? pick : null;
}
