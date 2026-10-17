import { ConflictException } from '@nestjs/common';

// ROK-1374: the guard is a pure predicate over the row, so the caller-level
// cases below mock every neighbour and pin ONLY that the write never happens.
jest.mock('./lineups-query.helpers', () => ({ findLineupById: jest.fn() }));
jest.mock('./lineups-eligibility.helpers', () => ({
  assertUserCanParticipate: jest.fn(),
}));
jest.mock('./lineups-voting.helpers', () => ({ toggleVote: jest.fn() }));
jest.mock('./lineups-response.helpers', () => ({
  buildDetailResponse: jest.fn(),
}));

import { findLineupById } from './lineups-query.helpers';
import { toggleVote } from './lineups-voting.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import { assertVoteOpen, runToggleVote } from './lineups-actions.helpers';

const NOW = new Date('2026-09-05T05:00:00Z');
const open = {
  id: 42,
  status: 'voting',
  maxVotesPerPlayer: 3,
  tieDetectedAt: null,
  tieExpiredAt: null,
  tiePickAt: null,
};

describe('assertVoteOpen (ROK-1374 — a tie hold closes the vote)', () => {
  it('409s VOTING_CLOSED_ON_TIE while a hold is open', () => {
    const held = { ...open, tieDetectedAt: NOW };
    expect(() => assertVoteOpen(held)).toThrow(
      new ConflictException('VOTING_CLOSED_ON_TIE'),
    );
  });

  it('stays closed after a pick — the grace window is the undo window, not a second round', () => {
    const picked = { ...open, tieDetectedAt: NOW, tiePickAt: NOW };
    expect(() => assertVoteOpen(picked)).toThrow(
      new ConflictException('VOTING_CLOSED_ON_TIE'),
    );
  });

  it('is open again once the hold expired (the sweep archived the lineup)', () => {
    const expired = { ...open, tieDetectedAt: NOW, tieExpiredAt: NOW };
    expect(() => assertVoteOpen(expired)).not.toThrow();
  });

  it('is open when no hold was ever recorded', () => {
    expect(() => assertVoteOpen(open)).not.toThrow();
  });
});

describe('runToggleVote (ROK-1374 — the guard runs before any write)', () => {
  const activityLog = { log: jest.fn() };
  const deps = {
    db: {} as never,
    activityLog: activityLog as never,
    resolveChannelName: jest.fn() as never,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (buildDetailResponse as jest.Mock).mockResolvedValue({ id: 42 });
    (toggleVote as jest.Mock).mockResolvedValue('added');
  });

  it('rejects a vote during an open hold and writes nothing', async () => {
    (findLineupById as jest.Mock).mockResolvedValue([
      { ...open, tieDetectedAt: NOW },
    ]);

    await expect(runToggleVote(deps, 42, 7, 9, 'member')).rejects.toThrow(
      new ConflictException('VOTING_CLOSED_ON_TIE'),
    );

    expect(toggleVote).not.toHaveBeenCalled();
    expect(activityLog.log).not.toHaveBeenCalled();
  });

  it('lets the vote through when no hold is open', async () => {
    (findLineupById as jest.Mock).mockResolvedValue([open]);

    await expect(runToggleVote(deps, 42, 7, 9, 'member')).resolves.toEqual({
      id: 42,
    });

    expect(toggleVote).toHaveBeenCalledWith(deps.db, 42, 9, 7, 3);
  });
});
