import { describe, it, expect } from 'vitest';
import { keptNightCount, lateCancelNight, memberNights } from './series-signup-format';
import { night, seriesState } from './series-signup.test-helpers';

describe('series-signup-format', () => {
    it('flags a member night starting just under 23h as a late cancel, not one at 23h01m', () => {
        expect(lateCancelNight([night(1, 22.98, 'in_series')])?.eventId).toBe(1);
        expect(lateCancelNight([night(2, 23.02, 'in_series')])).toBeUndefined();
    });

    it('counts only stays_inactive nights as kept and only in_series nights as member nights', () => {
        const state = seriesState([night(1, 30, 'in_series'), night(2, 200, 'stays_inactive', 'declined'), night(3, 400, 'will_create')]);
        expect(keptNightCount(state)).toBe(1);
        expect(memberNights(state).map((n) => n.eventId)).toEqual([1]);
    });
});
