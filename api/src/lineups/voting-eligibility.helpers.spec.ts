/**
 * Failing-first unit tests for the new voting-eligibility helper (ROK-1298).
 *
 * Helper does not yet exist — these MUST fail with a module-not-found
 * error until the dev creates `api/src/lineups/voting-eligibility.helpers.ts`.
 *
 * Per dev-brief-ROK-1298 §"What you actually ship → 2. API":
 *   - Private: 1 (creator) + invitees.filter(i => i.id !== lineup.createdBy).length
 *   - Public: totalMembers (from enrichment.totalMembers)
 *   - Guard: always >= 1.
 *
 * Helper signature (from the brief):
 *   computeVotingEligibleCount(
 *     lineup: { createdBy: number; visibility: 'public' | 'private' },
 *     invitees: { id: number }[],
 *     totalMembers: number,
 *   ): number
 */
import { computeVotingEligibleCount } from './voting-eligibility.helpers';

interface LineupShape {
  createdBy: number;
  visibility: 'public' | 'private';
}

function makeLineup(overrides: Partial<LineupShape> = {}): LineupShape {
  return { createdBy: 10, visibility: 'public', ...overrides };
}

describe('computeVotingEligibleCount (ROK-1298)', () => {
  describe('public lineups', () => {
    it('returns totalMembers for a public lineup', () => {
      const lineup = makeLineup({ visibility: 'public' });
      expect(computeVotingEligibleCount(lineup, [], 12)).toBe(12);
    });

    it('returns totalMembers regardless of invitees array for public lineups', () => {
      const lineup = makeLineup({ visibility: 'public' });
      // Public lineups ignore the invitee list entirely.
      const invitees = [{ id: 1 }, { id: 2 }, { id: 3 }];
      expect(computeVotingEligibleCount(lineup, invitees, 20)).toBe(20);
    });

    it('falls back to 1 (creator floor) when totalMembers is 0 on a public lineup', () => {
      const lineup = makeLineup({ visibility: 'public' });
      // Guard: creator is always eligible, so the floor is 1.
      expect(computeVotingEligibleCount(lineup, [], 0)).toBe(1);
    });
  });

  describe('private lineups', () => {
    it('returns 1 + invitee count when creator is NOT in the invitee list', () => {
      const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
      const invitees = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
      // 1 (creator) + 5 invitees (none of whom are id=10) = 6.
      expect(computeVotingEligibleCount(lineup, invitees, 99)).toBe(6);
    });

    it('dedupes the creator when they appear in the invitee list', () => {
      const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
      // Creator (id=10) appears in the invitee list — must NOT double-count.
      const invitees = [{ id: 10 }, { id: 1 }, { id: 2 }];
      // 1 (creator) + 2 non-creator invitees = 3 (NOT 4).
      expect(computeVotingEligibleCount(lineup, invitees, 99)).toBe(3);
    });

    it('returns 1 for a private lineup with no invitees (creator only)', () => {
      const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
      expect(computeVotingEligibleCount(lineup, [], 99)).toBe(1);
    });

    it('ignores totalMembers entirely for private lineups', () => {
      const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
      const invitees = [{ id: 1 }, { id: 2 }];
      // totalMembers=200 must not bleed into the private calculation.
      expect(computeVotingEligibleCount(lineup, invitees, 200)).toBe(3);
    });

    it('handles a 5-invitee private lineup (spec exemplar: returns 6)', () => {
      // Direct mirror of the spec scenario: 5 invitees → 6 eligible voters.
      const lineup = makeLineup({ visibility: 'private', createdBy: 99 });
      const invitees = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
      expect(computeVotingEligibleCount(lineup, invitees, 12)).toBe(6);
    });
  });

  describe('floor guard (>= 1)', () => {
    it('never returns 0 for a public lineup', () => {
      const lineup = makeLineup({ visibility: 'public' });
      expect(computeVotingEligibleCount(lineup, [], 0)).toBeGreaterThanOrEqual(
        1,
      );
    });

    it('never returns 0 for a private lineup', () => {
      const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
      expect(computeVotingEligibleCount(lineup, [], 0)).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});
