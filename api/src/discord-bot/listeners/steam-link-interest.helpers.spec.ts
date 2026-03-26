/**
 * TDD tests for steam-link-interest.helpers.ts — DB lookup helpers (ROK-966).
 *
 * These tests define the expected behavior of helper functions that
 * interact with the database to support the Steam URL interest prompt.
 *
 * The implementation file does NOT exist yet. These tests MUST fail
 * with "Cannot find module" until the dev agent creates the source.
 *
 * Uses the flat Drizzle mock pattern from drizzle-mock.ts.
 */
import {
  findGameBySteamAppId,
  findLinkedRlUser,
  hasExistingHeartInterest,
  getAutoHeartSteamUrlsPref,
  addDiscordInterest,
  setAutoHeartSteamUrlsPref,
} from './steam-link-interest.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

let mockDb: MockDb;

beforeEach(() => {
  mockDb = createDrizzleMock();
});

describe('findGameBySteamAppId', () => {
  it('returns the game when a matching steamAppId exists', async () => {
    const mockGame = { id: 42, name: 'Counter-Strike 2', steamAppId: 730 };
    mockDb.limit.mockResolvedValueOnce([mockGame]);

    const result = await findGameBySteamAppId(mockDb as never, 730);

    expect(result).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
    });
  });

  it('returns null when no game matches the steamAppId', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await findGameBySteamAppId(mockDb as never, 99999);

    expect(result).toBeNull();
  });
});

describe('findLinkedRlUser', () => {
  it('returns the user when discord ID is linked', async () => {
    const mockUser = { id: 7, discordId: 'discord-user-123' };
    mockDb.limit.mockResolvedValueOnce([mockUser]);

    const result = await findLinkedRlUser(mockDb as never, 'discord-user-123');

    expect(result).toMatchObject({
      id: expect.any(Number),
    });
  });

  it('returns null when discord ID is not linked', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await findLinkedRlUser(
      mockDb as never,
      'unknown-discord-id',
    );

    expect(result).toBeNull();
  });
});

describe('hasExistingHeartInterest', () => {
  it('returns true when user already has a heart interest for the game', async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: 1 }]);

    const result = await hasExistingHeartInterest(mockDb as never, 7, 42);

    expect(result).toBe(true);
  });

  it('returns false when user has no heart interest for the game', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await hasExistingHeartInterest(mockDb as never, 7, 42);

    expect(result).toBe(false);
  });
});

describe('getAutoHeartSteamUrlsPref', () => {
  it('returns true when user has auto-heart preference enabled', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { key: 'autoHeartSteamUrls', value: true },
    ]);

    const result = await getAutoHeartSteamUrlsPref(mockDb as never, 7);

    expect(result).toBe(true);
  });

  it('returns false when preference row does not exist', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await getAutoHeartSteamUrlsPref(mockDb as never, 7);

    expect(result).toBe(false);
  });

  it('returns false when preference value is explicitly false', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { key: 'autoHeartSteamUrls', value: false },
    ]);

    const result = await getAutoHeartSteamUrlsPref(mockDb as never, 7);

    expect(result).toBe(false);
  });
});

describe('addDiscordInterest', () => {
  it('inserts a game_interests row with source discord', async () => {
    mockDb.onConflictDoNothing.mockResolvedValueOnce(undefined);

    await addDiscordInterest(mockDb as never, 7, 42);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        gameId: 42,
        source: 'discord',
      }),
    );
  });

  it('does not throw on conflict (idempotent)', async () => {
    mockDb.onConflictDoNothing.mockResolvedValueOnce(undefined);

    await expect(
      addDiscordInterest(mockDb as never, 7, 42),
    ).resolves.not.toThrow();

    expect(mockDb.onConflictDoNothing).toHaveBeenCalled();
  });
});

describe('setAutoHeartSteamUrlsPref', () => {
  it('upserts the autoHeartSteamUrls preference to true', async () => {
    mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

    await setAutoHeartSteamUrlsPref(mockDb as never, 7, true);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        key: 'autoHeartSteamUrls',
        value: true,
      }),
    );
  });

  it('uses onConflictDoUpdate for upsert semantics', async () => {
    mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

    await setAutoHeartSteamUrlsPref(mockDb as never, 7, true);

    expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
  });
});
