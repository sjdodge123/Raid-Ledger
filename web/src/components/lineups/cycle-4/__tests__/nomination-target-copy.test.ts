/**
 * ROK-1710 — `targetSuffix` tells the three silent-or-not states apart: no
 * target and an unarmed target stay silent, a target an operator revert
 * disarmed says early advance is off, and an armed one promises N%.
 */
import { describe, it, expect } from 'vitest';
import { targetSuffix, DISARMED_TARGET_COPY } from '../nomination-target-copy';

const base = {
    nominationTargetPct: 50 as number | null,
    nominationTargetDisarmedAt: null as string | null,
    nominationTargetArmed: true,
};

describe('targetSuffix', () => {
    it('is empty for a deadline-only lineup (no target)', () => {
        expect(targetSuffix({ ...base, nominationTargetPct: null })).toBe('');
    });

    it('is empty for an unarmed target (seeded at or above it)', () => {
        expect(targetSuffix({ ...base, nominationTargetArmed: false })).toBe('');
    });

    it('says early advance is off once a revert disarmed the target', () => {
        const suffix = targetSuffix({ ...base, nominationTargetDisarmedAt: '2026-08-31T00:00:00.000Z' });
        expect(suffix).toBe(` · ${DISARMED_TARGET_COPY}`);
        expect(DISARMED_TARGET_COPY).toBe('Early advance is off — this lineup was reverted');
    });

    it('promises early voting while the target is armed', () => {
        expect(targetSuffix(base)).toBe(' · voting opens at 50%');
    });
});
