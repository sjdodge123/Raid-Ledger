/**
 * Tests for the shared roster-size rule (TD batch 4 B1, from ROK-1444).
 */
import { describe, it, expect } from 'vitest';
import { createMockLineupDetail } from '../../test/lineup-factories';
import { rosterSize } from './lineup-roster-size';

const invitee = (id: number) => ({ id, displayName: `U${id}`, steamLinked: false });

describe('rosterSize', () => {
    it('uses the Common Ground participant count, not the community size', () => {
        const lineup = createMockLineupDetail({ votingEligibleCount: 249 });
        expect(rosterSize(lineup, 3)).toBe(3);
    });

    it('takes the larger of participants and distinct invitees + creator', () => {
        const lineup = createMockLineupDetail({
            invitees: [invitee(2), invitee(3), invitee(4), invitee(5)],
        });
        expect(rosterSize(lineup, 1)).toBe(5);
    });

    it('does not double-count a creator who is also an invitee', () => {
        const lineup = createMockLineupDetail({
            createdBy: { id: 1, displayName: 'Admin' },
            invitees: [invitee(1), invitee(2), invitee(3)],
        });
        expect(rosterSize(lineup, 0)).toBe(3);
    });

    it('returns undefined below two people', () => {
        const lineup = createMockLineupDetail();
        expect(rosterSize(lineup, 1)).toBeUndefined();
        expect(rosterSize(lineup, 0)).toBeUndefined();
    });
});
