/**
 * Unit coverage for the pure candidate-set merge used by the match-scoped
 * participants roster (ROK-1557). The DB-touching loaders are covered by
 * `lineups-participants.integration.spec.ts`.
 */
import { collectMatchCandidateIds } from './lineups-participants-match.helpers';

describe('collectMatchCandidateIds (ROK-1557)', () => {
  it('always includes the creator first, even with no members or voters', () => {
    expect(collectMatchCandidateIds(7, [], [])).toEqual([7]);
  });

  it('unions match members and schedule voters without duplicating anyone', () => {
    // 2 is both a member and a voter; 7 (creator) is also enrolled as a member.
    const ids = collectMatchCandidateIds(7, [7, 2, 3], [2, 9]);
    expect(ids).toEqual([7, 2, 3, 9]);
  });

  it('includes a voter who was never enrolled as a match member', () => {
    expect(collectMatchCandidateIds(1, [1], [42])).toContain(42);
  });

  it('accepts Sets (the shape the loaders hand it)', () => {
    const ids = collectMatchCandidateIds(1, new Set([2]), new Set([2, 3]));
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
