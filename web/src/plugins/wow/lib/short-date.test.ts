/**
 * ROK-1789 Part B — the one "Nov 10" formatter shared by the Raid progress
 * card, the Progression tab and its activity feed. Noon UTC keeps the day
 * stable in every timezone the suite may run in.
 */
import { describe, it, expect } from 'vitest';
import { formatShortDate } from './short-date';

describe('formatShortDate', () => {
    it('renders the short month and day only', () => {
        const out = formatShortDate('2026-11-10T12:00:00.000Z');
        expect(out).toMatch(/^\S+ \d{1,2}$|^\d{1,2} \S+$/);
        expect(out).toMatch(/\b10\b/);
        expect(out).not.toMatch(/2026/);
    });

    it('matches the viewer-locale short date the cards used before the extraction', () => {
        const iso = '2026-11-06T12:00:00.000Z';
        expect(formatShortDate(iso)).toBe(new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    });
});
