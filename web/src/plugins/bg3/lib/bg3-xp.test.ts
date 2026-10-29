import { describe, expect, it } from 'vitest';
import { BG3_MAX_LEVEL, xpProgress } from './bg3-xp';

describe('xpProgress (Q3)', () => {
    it('measures from the level floor to the next threshold', () => {
        // Fixture act2-party-4p-summon: level 8, 35,630 total → 5,630 of 12,000.
        const p = xpProgress(8, 35_630);
        expect(p.fraction).toBeCloseTo(5_630 / 12_000, 5);
        expect(p.toNext).toBe(42_000 - 35_630);
        expect(p.atMax).toBe(false);
    });

    it('starts level 1 at zero', () => {
        expect(xpProgress(1, 150)).toEqual({ fraction: 0.5, atMax: false, toNext: 150 });
    });

    it('clamps out-of-table totals into 0..1', () => {
        expect(xpProgress(5, 1_000).fraction).toBe(0);
        expect(xpProgress(5, 99_999).fraction).toBe(1);
        expect(xpProgress(5, 99_999).toNext).toBe(0);
    });

    it('shows a full bar with no next level at the cap and beyond', () => {
        expect(xpProgress(BG3_MAX_LEVEL, 100_000)).toEqual({ fraction: 1, atMax: true, toNext: null });
        expect(xpProgress(14, 0)).toEqual({ fraction: 1, atMax: true, toNext: null });
    });

    it('treats level 11 as the last measured step (76,000 → 100,000)', () => {
        expect(xpProgress(11, 88_000).fraction).toBe(0.5);
    });
});
