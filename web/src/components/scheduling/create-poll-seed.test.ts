/** ROK-2212 — the seeded poll members are compared as a set (review NIT 9). */
import { describe, it, expect } from 'vitest';
import { sameIds } from './create-poll-seed';

describe('sameIds', () => {
    it('treats a re-ordered selection as unchanged', () => {
        expect(sameIds([2, 1], [1, 2]), 'untick 1 then re-tick 1 gives [2,1] — still the seed').toBe(true);
    });

    it('sees an added, removed or swapped member', () => {
        expect(sameIds([1, 2, 3], [1, 2])).toBe(false);
        expect(sameIds([1], [1, 2])).toBe(false);
        expect(sameIds([1, 3], [1, 2])).toBe(false);
    });
});
