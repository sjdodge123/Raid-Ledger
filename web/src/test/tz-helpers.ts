/**
 * ROK-2229 — viewer-timezone test helpers. Expectations are built with an
 * explicit `timeZone`, so a component that formats in UTC (or the server's
 * zone) instead of the viewer's fails.
 */
import { afterAll, beforeAll, vi } from 'vitest';

/** A viewer zone that is never UTC (EST, UTC-5, in late November). */
export const VIEWER_ZONE = 'America/New_York';

/**
 * 2026-11-23T02:30Z is Sun 22 Nov 21:30 in New York (EST, UTC-5) but Mon 23
 * Nov in UTC — the calendar day differs, so a UTC regression changes the date.
 */
export const SPLIT_DAY_START = '2026-11-23T02:30:00.000Z';
/** Three hours after `SPLIT_DAY_START` (Mon 23 Nov 00:30 in New York). */
export const SPLIT_DAY_END = '2026-11-23T05:30:00.000Z';

/** "Sun, Nov 22" — the short date of `iso` in `timeZone`. */
export function shortDateIn(iso: string, timeZone: string): string {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
}

/** "09:30 PM" — the start time of `iso` in `timeZone`. */
export function timeIn(iso: string, timeZone: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone });
}

/**
 * Pins the process zone for the calling file. `process.env.TZ` set at runtime
 * only reaches `Intl` in a forked worker (Node re-reads it per process), which
 * holds because `web/vitest.config.ts` runs the default `forks` pool.
 */
export function pinViewerZone(zone: string = VIEWER_ZONE): void {
    beforeAll(() => {
        vi.stubEnv('TZ', zone);
    });
    afterAll(() => {
        vi.unstubAllEnvs();
    });
}
