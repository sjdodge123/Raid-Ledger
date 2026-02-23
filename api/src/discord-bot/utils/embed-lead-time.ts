/**
 * Lead-time gating utilities for series event embeds (ROK-434).
 *
 * When a recurring series is created (e.g., weekly raid for 8 weeks),
 * we must not flood the Discord channel with embeds for every instance.
 * Instead, embeds are deferred and posted when the event is approaching.
 *
 * Lead time = min(6 days, seriesInterval).
 * Deferred embeds post at 1:00 PM community timezone.
 */

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
const POSTING_HOUR = 13; // 1:00 PM in community timezone

/**
 * Convert a recurrence frequency string to its interval in milliseconds.
 */
export function getSeriesIntervalMs(
  frequency: 'weekly' | 'biweekly' | 'monthly',
): number {
  switch (frequency) {
    case 'weekly':
      return 7 * 24 * 60 * 60 * 1000;
    case 'biweekly':
      return 14 * 24 * 60 * 60 * 1000;
    case 'monthly':
      // Approximate 30 days
      return 30 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Compute the lead time in milliseconds for a series.
 * Returns min(6 days, seriesInterval).
 */
export function computeLeadTimeMs(seriesIntervalMs: number): number {
  return Math.min(SIX_DAYS_MS, seriesIntervalMs);
}

/**
 * Compute the UTC datetime when the embed should be posted.
 * The embed posts at 1:00 PM community timezone on the day that is
 * `leadTimeMs` before the event start.
 *
 * @param eventStartTime - ISO 8601 event start time
 * @param leadTimeMs - Lead time in milliseconds
 * @param communityTimezone - IANA timezone string (e.g., 'America/New_York')
 * @returns UTC Date when the embed should be posted
 */
export function computePostAt(
  eventStartTime: string,
  leadTimeMs: number,
  communityTimezone: string,
): Date {
  const eventStart = new Date(eventStartTime);
  const postDate = new Date(eventStart.getTime() - leadTimeMs);

  // Convert the post date to the community timezone to find the calendar date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: communityTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(postDate);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value) - 1; // 0-based
  const day = Number(parts.find((p) => p.type === 'day')!.value);

  // Convert "POSTING_HOUR:00 in communityTimezone on (year, month, day)" to UTC.
  // We use the timezone offset derived from Intl.DateTimeFormat.
  return localDateTimeToUtc(year, month, day, POSTING_HOUR, communityTimezone);
}

/**
 * Convert a calendar date/time in a specific IANA timezone to a UTC Date.
 *
 * Strategy: create a UTC date with the same numeric components, then use
 * Intl to find the offset between UTC and the target timezone at that instant,
 * and adjust accordingly.
 */
function localDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timezone: string,
): Date {
  // Start with a UTC guess using the same numeric values
  const utcGuess = new Date(Date.UTC(year, month, day, hour, 0, 0, 0));

  // Use Intl to find what the timezone's offset is at this UTC instant
  const offsetMs = getTimezoneOffsetMs(utcGuess, timezone);

  // The UTC time we want = utcGuess - offset
  // (e.g., if timezone is UTC+5, we need to subtract 5h to get UTC)
  const adjusted = new Date(utcGuess.getTime() - offsetMs);

  // Verify: the offset at the adjusted time might differ (DST boundary).
  // Re-check and correct if needed.
  const verifyOffset = getTimezoneOffsetMs(adjusted, timezone);
  if (verifyOffset !== offsetMs) {
    return new Date(utcGuess.getTime() - verifyOffset);
  }

  return adjusted;
}

/**
 * Get the timezone offset in milliseconds (local - UTC) for a given
 * UTC instant and IANA timezone. Positive = east of UTC.
 */
function getTimezoneOffsetMs(utcDate: Date, timezone: string): number {
  // Format parts in both UTC and the target timezone
  const utcParts = getDateParts(utcDate, 'UTC');
  const tzParts = getDateParts(utcDate, timezone);

  // Build comparable timestamps from parts (using a reference epoch)
  const utcMs = Date.UTC(
    utcParts.year,
    utcParts.month - 1,
    utcParts.day,
    utcParts.hour,
    utcParts.minute,
    utcParts.second,
  );
  const tzMs = Date.UTC(
    tzParts.year,
    tzParts.month - 1,
    tzParts.day,
    tzParts.hour,
    tzParts.minute,
    tzParts.second,
  );

  return tzMs - utcMs;
}

/**
 * Extract numeric date parts from a Date using Intl.DateTimeFormat.
 * This avoids any system-timezone dependency.
 */
function getDateParts(
  date: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = f.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Determine whether an embed should be posted now for a given event.
 *
 * Returns true if the current UTC time is >= the computed posting time
 * (i.e., we are within the lead-time window AND past 1 PM community time
 * on the posting day).
 *
 * @param eventStartTime - ISO 8601 event start time
 * @param leadTimeMs - Lead time in milliseconds
 * @param communityTimezone - IANA timezone string
 * @param now - Optional current time for testing (defaults to Date.now())
 * @returns true if the embed should be posted now
 */
export function shouldPostEmbed(
  eventStartTime: string,
  leadTimeMs: number,
  communityTimezone: string,
  now?: Date,
): boolean {
  const currentTime = now ?? new Date();
  const eventStart = new Date(eventStartTime);

  // Never post embeds for past events
  if (eventStart <= currentTime) {
    return false;
  }

  const postAt = computePostAt(eventStartTime, leadTimeMs, communityTimezone);
  return currentTime >= postAt;
}

/**
 * Compute lead-time parameters from a recurrence rule.
 * Returns null for standalone (non-recurring) events.
 */
export function getLeadTimeFromRecurrence(
  recurrenceRule:
    | { frequency: 'weekly' | 'biweekly' | 'monthly' }
    | null
    | undefined,
): number | null {
  if (!recurrenceRule) return null;
  const intervalMs = getSeriesIntervalMs(recurrenceRule.frequency);
  return computeLeadTimeMs(intervalMs);
}
