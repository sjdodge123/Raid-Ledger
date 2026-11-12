/** Formatting + copy helpers for "GG <year>" cards (ROK-2187). */
import type { GgSuperlativeKey } from '@raid-ledger/contract';

/** Whole hours, e.g. 1_368_000 → "380h". */
export function ggHours(seconds: number): string {
    return `${Math.round(seconds / 3600).toLocaleString()}h`;
}

/** "3h 12m" style duration for voice time. */
export function ggDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Percentage, e.g. 0.94 → "94%". */
export function ggPercent(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Month name for 1–12. */
export const ggMonth = (m: number): string => MONTHS[m - 1] ?? '';
/** Weekday name for 0 (Sunday) – 6. */
export const ggWeekday = (d: number): string => WEEKDAYS[d] ?? '';
/** "22:00". */
export const ggHour = (h: number): string => `${String(h).padStart(2, '0')}:00`;

/** Title, emoji and line for each superlative. */
export const GG_SUPERLATIVES: Readonly<Record<GgSuperlativeKey, { title: string; glyph: string; line: string }>> = {
    'night-owl': { title: 'The Night Owl', glyph: '🦉', line: 'Your best runs started after dark.' },
    'always-on-time': { title: 'Always On Time', glyph: '⏱', line: 'You were there before the pull, every time.' },
    'the-planner': { title: 'The Planner', glyph: '🗓', line: 'You put the events on the calendar.' },
    explorer: { title: 'The Explorer', glyph: '🧭', line: 'New games never scared you.' },
    'voice-regular': { title: 'The Voice of the Raid', glyph: '🎙', line: 'Comms were never quiet with you around.' },
    regular: { title: 'The Regular', glyph: '⭐', line: 'Week in, week out — you showed up.' },
    'welcome-aboard': { title: 'Welcome Aboard', glyph: '🎉', line: 'This was the year you joined the party.' },
};
