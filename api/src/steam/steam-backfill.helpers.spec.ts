import {
  backfillUnmatchedSteamGames,
  BACKFILL_BATCH_SIZE,
  MAX_BACKFILL_LOOKUPS,
} from './steam-backfill.helpers';
import type { IgdbApiGame } from '../igdb/igdb.constants';

describe('backfillUnmatchedSteamGames', () => {
  let mockQueryIgdb: jest.Mock<Promise<IgdbApiGame[]>>;
  let mockUpsertGames: jest.Mock<Promise<{ length: number }[]>>;

  beforeEach(() => {
    mockQueryIgdb = jest.fn().mockResolvedValue([]);
    mockUpsertGames = jest.fn().mockResolvedValue([]);
  });

  it('returns 0 when no unmatched app IDs provided', async () => {
    const result = await backfillUnmatchedSteamGames(
      [],
      mockQueryIgdb,
      mockUpsertGames,
    );
    expect(result).toBe(0);
    expect(mockQueryIgdb).not.toHaveBeenCalled();
  });

  it('queries IGDB with correct APICALYPSE syntax', async () => {
    const apiGame: IgdbApiGame = {
      id: 100,
      name: 'Test Game',
      slug: 'test-game',
    };
    mockQueryIgdb.mockResolvedValueOnce([apiGame]);

    await backfillUnmatchedSteamGames(
      [1245620],
      mockQueryIgdb,
      mockUpsertGames,
    );

    expect(mockQueryIgdb).toHaveBeenCalledWith(
      expect.stringContaining('external_games.uid = ("1245620")'),
    );
    expect(mockQueryIgdb).toHaveBeenCalledWith(
      expect.stringContaining('external_games.category = 1'),
    );
  });

  it('calls upsertGames with IGDB results', async () => {
    const apiGame: IgdbApiGame = {
      id: 100,
      name: 'Test Game',
      slug: 'test-game',
    };
    mockQueryIgdb.mockResolvedValueOnce([apiGame]);

    await backfillUnmatchedSteamGames(
      [1245620],
      mockQueryIgdb,
      mockUpsertGames,
    );

    expect(mockUpsertGames).toHaveBeenCalledWith([apiGame]);
  });

  it('returns total count of imported games across batches', async () => {
    const games = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      name: `Game ${i}`,
      slug: `game-${i}`,
    }));
    mockQueryIgdb.mockResolvedValue(games);
    // Two batches needed for BACKFILL_BATCH_SIZE + 1 items
    const appIds = Array.from(
      { length: BACKFILL_BATCH_SIZE + 1 },
      (_, i) => i + 1000,
    );

    const result = await backfillUnmatchedSteamGames(
      appIds,
      mockQueryIgdb,
      mockUpsertGames,
    );

    // Two batches, 3 games each = 6
    expect(result).toBe(6);
    expect(mockQueryIgdb).toHaveBeenCalledTimes(2);
  });

  it('caps lookups at MAX_BACKFILL_LOOKUPS', async () => {
    const appIds = Array.from(
      { length: MAX_BACKFILL_LOOKUPS + 100 },
      (_, i) => i + 1,
    );

    await backfillUnmatchedSteamGames(
      appIds,
      mockQueryIgdb,
      mockUpsertGames,
    );

    // Should only query up to MAX_BACKFILL_LOOKUPS, not all
    const totalQueried = (mockQueryIgdb.mock.calls as string[][])
      .map((call) => {
        const match = call[0].match(/uid = \(([^)]+)\)/);
        return match ? match[1].split(',').length : 0;
      })
      .reduce((sum, n) => sum + n, 0);
    expect(totalQueried).toBeLessThanOrEqual(MAX_BACKFILL_LOOKUPS);
  });

  it('continues processing when a batch fails', async () => {
    mockQueryIgdb
      .mockRejectedValueOnce(new Error('IGDB timeout'))
      .mockResolvedValueOnce([
        { id: 1, name: 'Game', slug: 'game' },
      ]);

    const appIds = Array.from(
      { length: BACKFILL_BATCH_SIZE * 2 },
      (_, i) => i + 1,
    );

    const result = await backfillUnmatchedSteamGames(
      appIds,
      mockQueryIgdb,
      mockUpsertGames,
    );

    expect(result).toBe(1);
    expect(mockQueryIgdb).toHaveBeenCalledTimes(2);
  });

  it('does not call upsertGames when IGDB returns empty', async () => {
    mockQueryIgdb.mockResolvedValueOnce([]);

    await backfillUnmatchedSteamGames(
      [12345],
      mockQueryIgdb,
      mockUpsertGames,
    );

    expect(mockUpsertGames).not.toHaveBeenCalled();
  });
});
