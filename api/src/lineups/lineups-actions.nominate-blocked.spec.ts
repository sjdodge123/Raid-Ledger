/**
 * ROK-2298: runNominate refuses a banned/deactivated account before any read
 * or write — the Steam-link DM nominate path bypasses NotDeactivatedGuard.
 */
jest.mock('./lineups-query.helpers', () => ({ findLineupById: jest.fn() }));

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { findLineupById } from './lineups-query.helpers';
import { runNominate, type NominateDeps } from './lineups-actions.helpers';

function makeDeps(flags: unknown[]): NominateDeps {
  const db = createDrizzleMock();
  db.limit.mockResolvedValueOnce(flags);
  return {
    db: db as unknown as PostgresJsDatabase<typeof schema>,
    activityLog: { log: jest.fn() } as never,
    lineupNotifications: {} as never,
    logger: { warn: jest.fn(), log: jest.fn() } as never,
    resolveChannelName: jest.fn() as never,
    afterMutate: jest.fn(),
  };
}

describe('runNominate — blocked accounts (ROK-2298)', () => {
  beforeEach(() => jest.mocked(findLineupById).mockReset());

  it.each([
    ['banned', { bannedAt: new Date(), deactivatedAt: new Date() }],
    ['deactivated', { bannedAt: null, deactivatedAt: new Date() }],
  ])(
    'refuses a %s user with ACCOUNT_BLOCKED before loading the lineup',
    async (_l, flags) => {
      const deps = makeDeps([flags]);
      await expect(
        runNominate(deps, 1, { gameId: 5 }, 10, 'member'),
      ).rejects.toMatchObject({ response: { code: 'ACCOUNT_BLOCKED' } });
      expect(findLineupById).not.toHaveBeenCalled();
      expect(deps.afterMutate).not.toHaveBeenCalled();
    },
  );

  it('an active user proceeds to the lineup lookup', async () => {
    const deps = makeDeps([{ bannedAt: null, deactivatedAt: null }]);
    jest.mocked(findLineupById).mockResolvedValueOnce([]);
    await expect(
      runNominate(deps, 1, { gameId: 5 }, 10, 'member'),
    ).rejects.toThrow('Lineup not found');
    expect(findLineupById).toHaveBeenCalledTimes(1);
  });
});
