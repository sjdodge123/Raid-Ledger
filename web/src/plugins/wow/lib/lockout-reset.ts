/**
 * ROK-1743: "Resets in …" countdown for a saved-instance lockout. Under a day
 * it reuses `formatDuration` ("5h 12m" / "12m", "<1m" in the last minute); a day or more reads "3d 4h".
 * Returns null when the reset has passed or the timestamp is unparsable, so
 * the caller can drop the row.
 */
import { formatDuration } from '../../../lib/format-duration';

const DAY_SECONDS = 86_400;

export function formatResetIn(resetAtIso: string, nowMs: number): string | null {
    const resetMs = Date.parse(resetAtIso);
    if (Number.isNaN(resetMs) || resetMs <= nowMs) return null;
    const seconds = Math.floor((resetMs - nowMs) / 1000);
    if (seconds < 60) return 'Resets in <1m';
    if (seconds < DAY_SECONDS) return `Resets in ${formatDuration(seconds)}`;
    const days = Math.floor(seconds / DAY_SECONDS);
    const hours = Math.floor((seconds % DAY_SECONDS) / 3600);
    return `Resets in ${days}d ${hours}h`;
}
