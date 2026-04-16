/**
 * Unit tests for game deduplication DB cleanup helpers (ROK-1008 ACs 9-10).
 *
 * Tests the one-time cleanup logic that finds duplicate game rows in the DB
 * and merges them by reassigning FK references to the winner row.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  findDuplicateGames,
  mergeAndDeleteDuplicates,
  type DuplicateGroup,
} from './igdb-dedup-cleanup.helpers';

// ─── Test data ────────────────────────────────────────────────────────────

/** Build a DuplicateGroup for testing. */
function makeGroup(
  winnerId: number,
  loserIds: number[],
): DuplicateGroup {
  return { winnerId, loserIds };
}

// ─── findDuplicateGames ───────────────────────────────────────────────────

describe('findDuplicateGames', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns groups from both steamAppId and igdbId duplicates', async () => {
    const steamDups = [
      { key_val: 646570, ids: [1, 2], itad_ids: [null, 2] },
    ];
    const igdbDups = [
      { key_val: 12345, ids: [3, 4], itad_ids: [3, null] },
    ];

    // findDupsBySteamAppId: db.execute()
    mockDb.execute.mockResolvedValueOnce(steamDups);
    // findDupsByIgdbId: db.execute()
    mockDb.execute.mockResolvedValueOnce(igdbDups);

    const result = await findDuplicateGames(mockDb as never);

    expect(result).toHaveLength(2);
    // steamAppId group: ITAD row (id=2) wins
    expect(result[0]).toEqual({ winnerId: 2, loserIds: [1] });
    // igdbId group: ITAD row (id=3) wins
    expect(result[1]).toEqual({ winnerId: 3, loserIds: [4] });
  });

  it('returns empty array when no duplicates exist', async () => {
    mockDb.execute.mockResolvedValueOnce([]);
    mockDb.execute.mockResolvedValueOnce([]);

    const result = await findDuplicateGames(mockDb as never);

    expect(result).toEqual([]);
  });

  it('picks first id as winner when no ITAD row exists', async () => {
    const steamDups = [
      { key_val: 100, ids: [5, 6], itad_ids: [null, null] },
    ];

    mockDb.execute.mockResolvedValueOnce(steamDups);
    mockDb.execute.mockResolvedValueOnce([]);

    const result = await findDuplicateGames(mockDb as never);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ winnerId: 5, loserIds: [6] });
  });

  it('handles multiple losers in a single group', async () => {
    const steamDups = [
      { key_val: 200, ids: [10, 11, 12], itad_ids: [10, null, null] },
    ];

    mockDb.execute.mockResolvedValueOnce(steamDups);
    mockDb.execute.mockResolvedValueOnce([]);

    const result = await findDuplicateGames(mockDb as never);

    expect(result).toHaveLength(1);
    expect(result[0].winnerId).toBe(10);
    expect(result[0].loserIds).toEqual(expect.arrayContaining([11, 12]));
    expect(result[0].loserIds).toHaveLength(2);
  });

  it('deduplicates overlapping groups that share a winner', async () => {
    // Both steam and igdb find the same pair as duplicates
    const steamDups = [
      { key_val: 300, ids: [20, 21], itad_ids: [20, null] },
    ];
    const igdbDups = [
      { key_val: 400, ids: [20, 22], itad_ids: [20, null] },
    ];

    mockDb.execute.mockResolvedValueOnce(steamDups);
    mockDb.execute.mockResolvedValueOnce(igdbDups);

    const result = await findDuplicateGames(mockDb as never);

    // Should merge into a single group with winner=20
    expect(result).toHaveLength(1);
    expect(result[0].winnerId).toBe(20);
    expect(result[0].loserIds).toEqual(expect.arrayContaining([21, 22]));
    expect(result[0].loserIds).toHaveLength(2);
  });
});

// ─── mergeAndDeleteDuplicates ─────────────────────────────────────────────

describe('mergeAndDeleteDuplicates', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns merged count for successfully processed groups', async () => {
    const groups = [
      makeGroup(1, [2]),
      makeGroup(3, [4, 5]),
    ];

    // Each mergeGroup call uses a transaction
    // transaction mock already delegates to cb(mockDb)
    // Inside: reassignEventFks, reassignLineupFks, reassignMiscFks, delete
    // All of these use execute() or delete().where() chains
    // The flat mock handles them all by default

    const result = await mergeAndDeleteDuplicates(mockDb as never, groups);

    expect(result.merged).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('returns zero merged when given empty groups', async () => {
    const result = await mergeAndDeleteDuplicates(mockDb as never, []);

    expect(result).toEqual({ merged: 0, errors: [] });
  });

  it('captures errors for failed groups and continues processing', async () => {
    const groups = [
      makeGroup(1, [2]),
      makeGroup(3, [4]),
      makeGroup(5, [6]),
    ];

    // First group succeeds (default transaction mock works)
    // Second group: make the transaction throw
    let callCount = 0;
    mockDb.transaction.mockImplementation(async (fn) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('FK constraint violation');
      }
      return fn(mockDb);
    });

    const result = await mergeAndDeleteDuplicates(mockDb as never, groups);

    expect(result.merged).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('winner=3');
    expect(result.errors[0]).toContain('FK constraint violation');
  });

  it('reports all errors when every group fails', async () => {
    const groups = [makeGroup(1, [2]), makeGroup(3, [4])];

    mockDb.transaction.mockRejectedValue(new Error('DB down'));

    const result = await mergeAndDeleteDuplicates(mockDb as never, groups);

    expect(result.merged).toBe(0);
    expect(result.errors).toHaveLength(2);
  });

  it('calls transaction for each group to ensure atomicity', async () => {
    const groups = [makeGroup(10, [11]), makeGroup(20, [21])];

    await mergeAndDeleteDuplicates(mockDb as never, groups);

    expect(mockDb.transaction).toHaveBeenCalledTimes(2);
  });

  it('deletes loser rows inside the transaction', async () => {
    const groups = [makeGroup(100, [101, 102])];

    await mergeAndDeleteDuplicates(mockDb as never, groups);

    // delete() is called once per loser (2 losers)
    expect(mockDb.delete).toHaveBeenCalledTimes(2);
  });

  it('calls FK reassignment helpers for each loser', async () => {
    const groups = [makeGroup(50, [51])];

    await mergeAndDeleteDuplicates(mockDb as never, groups);

    // Each loser triggers execute() calls for FK reassignment
    // (safeReassign, safeReassignWithUnique, updateTiedGameIds, etc.)
    expect(mockDb.execute).toHaveBeenCalled();
  });
});

// ─── AC 10: admin endpoint return shape ───────────────────────────────────

describe('mergeAndDeleteDuplicates return shape (AC 10)', () => {
  it('returns { merged: number, errors: string[] } structure', async () => {
    const mockDb = createDrizzleMock();
    const groups = [makeGroup(1, [2])];

    const result = await mergeAndDeleteDuplicates(mockDb as never, groups);

    expect(result).toEqual(
      expect.objectContaining({
        merged: expect.any(Number),
        errors: expect.any(Array),
      }),
    );
  });

  it('merged count equals number of successfully processed groups', async () => {
    const mockDb = createDrizzleMock();
    const groups = [
      makeGroup(1, [2]),
      makeGroup(3, [4]),
      makeGroup(5, [6]),
    ];

    const result = await mergeAndDeleteDuplicates(mockDb as never, groups);

    expect(result.merged).toBe(3);
    expect(result.errors).toHaveLength(0);
  });
});
