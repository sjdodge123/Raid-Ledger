import { TZDate } from '@date-fns/tz';

/**
 * Convert a Date or ISO string to a TZDate in the given IANA timezone.
 * Used for react-big-calendar event positioning.
 */
export function toZonedDate(date: Date | string, timezone: string): TZDate {
    const d = typeof date === 'string' ? new Date(date) : date;
    return new TZDate(d.getTime(), timezone);
}

/**
 * Get the short timezone abbreviation (e.g. "EST", "PST", "JST")
 * for a given IANA timezone string.
 */
export function getTimezoneAbbr(timezone: string): string {
    return (
        new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
            .formatToParts(new Date())
            .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
}

/**
 * Get the UTC offset in minutes for a given IANA timezone at the current moment.
 * Equivalent to `new Date().getTimezoneOffset()` but for an arbitrary timezone.
 */
export function getTimezoneOffsetMinutes(timezone: string): number {
    return new TZDate(Date.now(), timezone).getTimezoneOffset();
}
