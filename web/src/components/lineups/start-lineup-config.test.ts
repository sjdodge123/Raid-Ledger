/**
 * ROK-1441 — `formatDurationHours` must never render a duration that differs
 * from the value actually submitted.
 *
 * Before ROK-1441 the duration slider was day-granular, so the only values
 * above 24h it could produce were whole multiples of 24 and rounding to days
 * was always exact. Making the slider hour-granular put 25h/36h within reach
 * by drag, at which point rounding to a day count would understate or
 * overstate the real phase deadline (Codex review, P2).
 */
import { describe, it, expect } from 'vitest';
import { formatDurationHours, LINEUP_PRESETS } from './start-lineup-config';

describe('formatDurationHours', () => {
    it('renders sub-hour values in minutes', () => {
        expect(formatDurationHours(0.25)).toBe('15 min');
        expect(formatDurationHours(0.5)).toBe('30 min');
    });

    it('renders sub-day values in hours', () => {
        expect(formatDurationHours(1)).toBe('1 hour');
        expect(formatDurationHours(5)).toBe('5 hours');
        expect(formatDurationHours(23)).toBe('23 hours');
    });

    it('renders whole multiples of 24h as days', () => {
        expect(formatDurationHours(24)).toBe('1 day');
        expect(formatDurationHours(48)).toBe('2 days');
        expect(formatDurationHours(168)).toBe('7 days');
        expect(formatDurationHours(720)).toBe('30 days');
    });

    it('does not round a partial day to a whole day', () => {
        // 36h previously rendered "2 days" — a 12-hour overstatement of the
        // deadline the form would actually submit.
        expect(formatDurationHours(36)).toBe('1d 12h');
        expect(formatDurationHours(25)).toBe('1d 1h');
        expect(formatDurationHours(167)).toBe('6d 23h');
    });

    it('does not round a fractional hour to a whole one', () => {
        // Reachable by typing into the numeric field (step="any").
        // 1.5 previously rendered "2 hours" — 30 minutes late.
        expect(formatDurationHours(1.5)).toBe('1h 30m');
        expect(formatDurationHours(24.5)).toBe('1d 30m');
        expect(formatDurationHours(36.25)).toBe('1d 12h 15m');
    });

    it('never claims a longer duration than the value given', () => {
        for (let h = 24; h <= 168; h++) {
            const rendered = formatDurationHours(h);
            const days = /^(\d+) days?$/.exec(rendered);
            if (days) {
                // A bare day count must be exact, not rounded.
                expect(Number(days[1]) * 24).toBe(h);
            }
        }
    });
});

describe('LINEUP_PRESETS', () => {
    it('keeps LAN as the 15-minute-a-phase shape', () => {
        expect(LINEUP_PRESETS.lan.buildingDurationHours).toBe(0.25);
        expect(LINEUP_PRESETS.lan.votingDurationHours).toBe(0.25);
    });

    it('gives Tonight at least 5 hours per phase', () => {
        expect(LINEUP_PRESETS.tonight.buildingDurationHours).toBeGreaterThanOrEqual(5);
        expect(LINEUP_PRESETS.tonight.votingDurationHours).toBeGreaterThanOrEqual(5);
    });

    it('keeps every preset duration inside the contract range (0.25-720)', () => {
        for (const preset of Object.values(LINEUP_PRESETS)) {
            for (const h of [preset.buildingDurationHours, preset.votingDurationHours]) {
                expect(h).toBeGreaterThanOrEqual(0.25);
                expect(h).toBeLessThanOrEqual(720);
            }
        }
    });
});
