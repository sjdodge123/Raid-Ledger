/**
 * ROK-1374 (Q2) — `deriveTopVotedGame` never breaks a joint top by game id.
 *
 * `guardTiebreakerOnTransition` throws TIEBREAKER_REQUIRED on a tie before
 * this runs, but that is a separate query; a vote landing between the two
 * used to let the lowest id "win". The helper now fails closed on its own.
 */
jest.mock('./lineups-query.helpers', () => ({
  ...jest.requireActual('./lineups-query.helpers'),
  countVotesPerGame: jest.fn(),
}));

import { countVotesPerGame } from './lineups-query.helpers';
import { deriveTopVotedGame } from './lineups-transition.helpers';

const db = {} as never;

describe('deriveTopVotedGame (ROK-1374 Q2)', () => {
  it('returns the unique top vote-getter', async () => {
    (countVotesPerGame as jest.Mock).mockResolvedValue([
      { gameId: 9, voteCount: 2 },
      { gameId: 7, voteCount: 3 },
    ]);
    await expect(deriveTopVotedGame(db, 42)).resolves.toBe(7);
  });

  it('returns null on a joint top instead of the lowest game id', async () => {
    (countVotesPerGame as jest.Mock).mockResolvedValue([
      { gameId: 9, voteCount: 3 },
      { gameId: 7, voteCount: 3 },
      { gameId: 5, voteCount: 1 },
    ]);
    await expect(deriveTopVotedGame(db, 42)).resolves.toBeNull();
  });

  it('returns null when nobody voted', async () => {
    (countVotesPerGame as jest.Mock).mockResolvedValue([]);
    await expect(deriveTopVotedGame(db, 42)).resolves.toBeNull();
  });
});
