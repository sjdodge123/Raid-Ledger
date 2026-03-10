import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { autoHeartCheck } from './game-activity-heart.helpers';

/**
 * Build a where mock that chains for the first N calls (Discord query),
 * then resolves to data for subsequent calls (Steam query + exclusions).
 * Discord: select→from→where(chain)→groupBy→having(terminal)
 * Steam:   select→from→where(terminal)
 * Exclusion queries each end with where(terminal).
 */
function buildWhereMock(
  db: MockDb,
  steamResult: Array<{ userId: number; gameId: number | null }>,
  optedOut: Array<{ userId: number }>,
  existing: Array<{ userId: number; gameId: number }>,
  suppressed: Array<{ userId: number; gameId: number }>,
) {
  let callCount = 0;
  db.where.mockImplementation(function (this: MockDb) {
    callCount++;
    // Call 1: Discord query chain → needs to continue to groupBy
    if (callCount === 1) return this;
    // Call 2: Steam query terminal
    if (callCount === 2) return Promise.resolve(steamResult);
    // Call 3: fetchOptedOutUsers
    if (callCount === 3) return Promise.resolve(optedOut);
    // Call 4: fetchExistingInterests
    if (callCount === 4) return Promise.resolve(existing);
    // Call 5: fetchSuppressions
    if (callCount === 5) return Promise.resolve(suppressed);
    return this;
  });
}

describe('autoHeartCheck', () => {
  let db: MockDb;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    db = createDrizzleMock();
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  });

  it('does nothing when no candidates found', async () => {
    db.having.mockResolvedValueOnce([]);
    buildWhereMock(db, [], [], [], []);

    await autoHeartCheck(db as any, logger as any);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts auto-hearted games from Steam playtime', async () => {
    db.having.mockResolvedValueOnce([]);
    buildWhereMock(db, [{ userId: 2, gameId: 20 }], [], [], []);
    db.onConflictDoNothing.mockResolvedValueOnce(undefined);

    await autoHeartCheck(db as any, logger as any);
    expect(db.insert).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('Auto-hearted 1 game(s) for users');
  });

  it('inserts Discord candidates', async () => {
    db.having.mockResolvedValueOnce([{ userId: 1, gameId: 10 }]);
    buildWhereMock(db, [], [], [], []);
    db.onConflictDoNothing.mockResolvedValueOnce(undefined);

    await autoHeartCheck(db as any, logger as any);
    expect(db.insert).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('Auto-hearted 1 game(s) for users');
  });

  it('deduplicates Discord and Steam candidates', async () => {
    db.having.mockResolvedValueOnce([{ userId: 1, gameId: 10 }]);
    buildWhereMock(db, [{ userId: 1, gameId: 10 }], [], [], []);
    db.onConflictDoNothing.mockResolvedValueOnce(undefined);

    await autoHeartCheck(db as any, logger as any);
    expect(db.values).toHaveBeenCalledWith([
      { userId: 1, gameId: 10, source: 'discord' },
    ]);
  });

  it('skips opted-out users', async () => {
    db.having.mockResolvedValueOnce([{ userId: 1, gameId: 10 }]);
    buildWhereMock(db, [{ userId: 1, gameId: 20 }], [{ userId: 1 }], [], []);

    await autoHeartCheck(db as any, logger as any);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('skips suppressed games', async () => {
    db.having.mockResolvedValueOnce([]);
    buildWhereMock(
      db,
      [{ userId: 3, gameId: 30 }],
      [],
      [],
      [{ userId: 3, gameId: 30 }],
    );

    await autoHeartCheck(db as any, logger as any);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('skips already-hearted games', async () => {
    db.having.mockResolvedValueOnce([{ userId: 1, gameId: 10 }]);
    buildWhereMock(db, [], [], [{ userId: 1, gameId: 10 }], []);

    await autoHeartCheck(db as any, logger as any);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
