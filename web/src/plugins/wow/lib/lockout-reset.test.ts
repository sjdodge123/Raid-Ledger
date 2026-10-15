/** ROK-1743: saved-instance reset countdown boundaries. */
import { describe, it, expect } from 'vitest';
import { formatResetIn } from './lockout-reset';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1000).toISOString();

describe('formatResetIn', () => {
    it.each<[string, number, string]>([
        ['days + hours', 3 * 86_400 + 4 * 3600 + 59 * 60, 'Resets in 3d 4h'],
        ['exactly one day', 86_400, 'Resets in 1d 0h'],
        ['hours + minutes', 5 * 3600 + 12 * 60 + 30, 'Resets in 5h 12m'],
        ['just under a day', 86_399, 'Resets in 23h 59m'],
        ['minutes only', 12 * 60 + 5, 'Resets in 12m'],
        ['under a minute', 30, 'Resets in <1m'],
    ])('%s', (_label, offset, expected) => {
        expect(formatResetIn(at(offset), NOW)).toBe(expected);
    });

    it.each<[string, string]>([
        ['already reset', at(-60)],
        ['resetting right now', at(0)],
        ['unparsable timestamp', 'not-a-date'],
        ['empty string', ''],
    ])('%s → null', (_label, iso) => {
        expect(formatResetIn(iso, NOW)).toBeNull();
    });
});
