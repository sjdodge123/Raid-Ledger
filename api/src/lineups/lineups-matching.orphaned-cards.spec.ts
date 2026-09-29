/**
 * TDB:571 — a re-decide wipes `suggested`/`scheduling` matches, and a wiped
 * `scheduling` match may already own a Discord poll card. Before the fix the
 * wipe dropped the row and forgot the card, leaving a live poll in the channel
 * whose buttons pointed at a match that no longer existed.
 *
 * `buildMatchesForLineup` must hand the wiped cards' (channel, message) refs
 * back to its caller so they can be deleted AFTER the transaction commits.
 */
import { buildMatchesForLineup } from './lineups-matching.helpers';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  countVotesPerGame,
  countDistinctVoters,
} from './lineups-query.helpers';

jest.mock('./lineups-query.helpers', () => ({
  countVotesPerGame: jest.fn(),
  countDistinctVoters: jest.fn(),
}));

const LINEUP_ID = 7;

describe('buildMatchesForLineup — orphaned poll cards (TDB:571)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createDrizzleMock();
    mockDb.limit.mockResolvedValueOnce([
      { matchThreshold: 35, includeSchedulingPhase: true },
    ]);
    // Zero-vote re-decide: the wipe still runs, nothing is re-inserted.
    (countVotesPerGame as jest.Mock).mockResolvedValue([]);
    (countDistinctVoters as jest.Mock).mockResolvedValue([{ total: 0 }]);
  });

  it('returns the card refs of every wiped match that had a posted card', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { embedChannelId: 'chan-1', embedMessageId: 'msg-1' },
      { embedChannelId: null, embedMessageId: null },
      { embedChannelId: 'chan-2', embedMessageId: null },
    ]);

    const result = await buildMatchesForLineup(mockDb as never, LINEUP_ID);

    expect(result.orphanedCards).toEqual([
      { channelId: 'chan-1', messageId: 'msg-1' },
    ]);
    expect(result.schedulingMatchIds).toEqual([]);
  });

  it('collects the refs inside the transaction, from the wipe itself', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await buildMatchesForLineup(mockDb as never, LINEUP_ID);

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.returning).toHaveBeenCalledWith(
      expect.objectContaining({
        embedChannelId: expect.anything(),
        embedMessageId: expect.anything(),
      }),
    );
  });

  it('returns no orphaned cards when the lineup does not exist', async () => {
    mockDb.limit.mockReset().mockResolvedValueOnce([]);

    const result = await buildMatchesForLineup(mockDb as never, LINEUP_ID);

    expect(result).toEqual({ schedulingMatchIds: [], orphanedCards: [] });
  });
});
