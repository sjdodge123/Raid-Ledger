import { describe, expect, it } from 'vitest';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import {
  getDistinctNominatorCount,
  getExpectedVoterCount,
} from './lineup-quorum-counts';

type LineupSubset = Pick<
  LineupDetailResponseDto,
  'visibility' | 'totalMembers' | 'createdBy' | 'invitees' | 'entries'
>;

function makeLineup(overrides: Partial<LineupSubset>): LineupSubset {
  return {
    visibility: 'public',
    totalMembers: 179,
    createdBy: { id: 1, displayName: 'Admin', avatar: null },
    invitees: [],
    entries: [],
    ...overrides,
  };
}

describe('getExpectedVoterCount', () => {
  it('returns totalMembers for public lineups', () => {
    expect(getExpectedVoterCount(makeLineup({ visibility: 'public' }))).toBe(179);
  });

  it('returns invitees + creator deduped for private lineups', () => {
    const lineup = makeLineup({
      visibility: 'private',
      createdBy: { id: 1, displayName: 'Admin', avatar: null },
      invitees: [
        { id: 2, displayName: 'Voter Two', steamLinked: false },
        { id: 3, displayName: 'Voter Three', steamLinked: false },
      ],
    });
    expect(getExpectedVoterCount(lineup)).toBe(3);
  });

  it('dedupes when creator is also in the invitee list', () => {
    const lineup = makeLineup({
      visibility: 'private',
      createdBy: { id: 1, displayName: 'Admin', avatar: null },
      invitees: [
        { id: 1, displayName: 'Admin', steamLinked: false },
        { id: 2, displayName: 'Voter Two', steamLinked: false },
      ],
    });
    expect(getExpectedVoterCount(lineup)).toBe(2);
  });

  it('returns 1 for a solo private lineup (creator alone)', () => {
    const lineup = makeLineup({
      visibility: 'private',
      invitees: [],
    });
    expect(getExpectedVoterCount(lineup)).toBe(1);
  });
});

describe('getDistinctNominatorCount', () => {
  it('returns 0 with no entries', () => {
    expect(getDistinctNominatorCount(makeLineup({ entries: [] }))).toBe(0);
  });

  it('counts distinct nominators only', () => {
    const lineup = makeLineup({
      entries: [
        { nominatedBy: { id: 1, displayName: 'A', avatar: null } },
        { nominatedBy: { id: 1, displayName: 'A', avatar: null } },
        { nominatedBy: { id: 2, displayName: 'B', avatar: null } },
      ] as unknown as LineupDetailResponseDto['entries'],
    });
    expect(getDistinctNominatorCount(lineup)).toBe(2);
  });
});
