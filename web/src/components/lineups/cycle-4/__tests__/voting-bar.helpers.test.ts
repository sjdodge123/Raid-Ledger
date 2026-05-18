/**
 * Failing-first unit tests for the vote-bar math helper (ROK-1298).
 *
 * Module does not yet exist — these MUST fail with module-not-found
 * until the dev creates
 * `web/src/components/lineups/cycle-4/voting-bar.helpers.ts`.
 *
 * Per spec §"Normalized vote-bar math":
 *   voteBarPct(voteCount, votingEligibleCount): number
 *   - Denominator is the voter pool, NOT the count of users who have
 *     cast >=1 vote (the legacy bug).
 *   - Returns Math.round((voteCount / votingEligibleCount) * 100),
 *     clamped to [0, 100].
 *   - Defensive: voteBarPct(*, 0) === 0 (no NaN reaches the DOM).
 *
 * The 1/12 = 8% case is the canonical regression guard for the
 * "100% bar with 1 vote" bug observed on 2026-05-15.
 */
import { describe, it, expect } from 'vitest';
import { voteBarPct } from '../voting-bar.helpers';

describe('voteBarPct — canonical regression guard (ROK-1298)', () => {
    it('returns 8 for 1 vote out of 12 eligible voters (NOT 100)', () => {
        // This is the explicit fix for the live-walkthrough bug:
        // the first vote on a 12-voter lineup MUST render the bar at
        // ~8%, not "full" (100%).
        expect(voteBarPct(1, 12)).toBe(8);
    });
});

describe('voteBarPct — happy path math', () => {
    it('returns 100 when every eligible voter has voted', () => {
        expect(voteBarPct(12, 12)).toBe(100);
    });

    it('returns 50 for half the eligible voters', () => {
        expect(voteBarPct(6, 12)).toBe(50);
    });

    it('returns 0 when nobody has voted yet', () => {
        expect(voteBarPct(0, 12)).toBe(0);
    });

    it('rounds the percentage (8.33% → 8)', () => {
        expect(voteBarPct(1, 12)).toBe(8);
    });

    it('rounds the percentage (16.66% → 17)', () => {
        expect(voteBarPct(2, 12)).toBe(17);
    });
});

describe('voteBarPct — zero-denominator guard (no NaN)', () => {
    it('returns 0 when votingEligibleCount === 0', () => {
        // Defensive — should never happen in production. The component
        // must never put NaN% in a `style.width` value.
        expect(voteBarPct(0, 0)).toBe(0);
    });

    it('returns 0 when votingEligibleCount is negative', () => {
        // Should never happen post-schema validation, but the helper
        // must not crash if it does.
        expect(voteBarPct(5, -3)).toBe(0);
    });
});

describe('voteBarPct — overflow clamp', () => {
    it('clamps a percentage above 100 down to 100', () => {
        // Pathological input — voteCount > eligibleCount shouldn't
        // happen post-fix, but the helper must clamp defensively.
        expect(voteBarPct(15, 12)).toBe(100);
    });

    it('clamps a negative percentage up to 0', () => {
        // Pathological — negative voteCount. Result must not be < 0.
        expect(voteBarPct(-1, 12)).toBe(0);
    });
});
