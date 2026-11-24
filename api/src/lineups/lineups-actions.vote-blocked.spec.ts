/**
 * ROK-2306: runToggleVote refuses a banned/deactivated account before any
 * lineup read or vote write — the service gate behind NotDeactivatedGuard, so
 * a non-HTTP caller (the demo cast-vote fixture today, a Discord path later)
 * cannot vote for a blocked user. Mirrors lineups-actions.nominate-blocked.
 */
jest.mock('./lineups-query.helpers', () => ({ findLineupById: jest.fn() }));
jest.mock('./lineups-voting.helpers', () => ({ toggleVote: jest.fn() }));

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { findLineupById } from './lineups-query.helpers';
import { toggleVote } from './lineups-voting.helpers';
import { runToggleVote, type VoteDeps } from './lineups-actions.helpers';

function makeDeps(flags: unknown[]): VoteDeps {
  const db = createDrizzleMock();
  db.limit.mockResolvedValueOnce(flags);
  return {
    db: db as unknown as PostgresJsDatabase<typeof schema>,
    activityLog: { log: jest.fn() } as never,
    resolveChannelName: jest.fn() as never,
  };
}

describe('runToggleVote — blocked accounts (ROK-2306)', () => {
  beforeEach(() => {
    jest.mocked(findLineupById).mockReset();
    jest.mocked(toggleVote).mockReset();
  });

  it.each([
    ['banned', { bannedAt: new Date(), deactivatedAt: null }],
    ['deactivated', { bannedAt: null, deactivatedAt: new Date() }],
  ])(
    'refuses a %s user with ACCOUNT_BLOCKED before loading the lineup',
    async (_l, flags) => {
      const deps = makeDeps([flags]);
      await expect(
        runToggleVote(deps, 1, 5, 10, 'member'),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACCOUNT_BLOCKED' },
      });
      expect(findLineupById).not.toHaveBeenCalled();
      expect(toggleVote).not.toHaveBeenCalled();
      expect(deps.activityLog.log).not.toHaveBeenCalled();
    },
  );

  it('an active user proceeds to the lineup lookup', async () => {
    const deps = makeDeps([{ bannedAt: null, deactivatedAt: null }]);
    jest.mocked(findLineupById).mockResolvedValueOnce([]);
    await expect(runToggleVote(deps, 1, 5, 10, 'member')).rejects.toThrow(
      'Lineup not found',
    );
    expect(findLineupById).toHaveBeenCalledTimes(1);
  });
});
