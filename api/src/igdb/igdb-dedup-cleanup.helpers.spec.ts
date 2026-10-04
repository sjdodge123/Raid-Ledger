/**
 * Unit tests for game deduplication DB cleanup helpers (ROK-1008 ACs 9-10).
 *
 * Tests the one-time cleanup logic that finds duplicate game rows in the DB
 * and merges them by reassigning FK references to the winner row.
 */
import { Logger } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  findDuplicateGames,
  mergeAndDeleteDuplicates,
  mergeNameDuplicates,
  type DuplicateGroup,
} from './igdb-dedup-cleanup.helpers';

// ─── Test data ────────────────────────────────────────────────────────────

/** Build a DuplicateGroup for testing. */
function makeGroup(winnerId: number, loserIds: number[]): DuplicateGroup {
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
      { key_val: 646570, ids: [1, 2], itad_ids: [null, 2], igdb_ids: [] },
    ];
    const igdbDups = [
      { key_val: 12345, ids: [3, 4], itad_ids: [3, null], igdb_ids: [] },
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
      { key_val: 100, ids: [5, 6], itad_ids: [null, null], igdb_ids: [] },
    ];

    mockDb.execute.mockResolvedValueOnce(steamDups);
    mockDb.execute.mockResolvedValueOnce([]);

    const result = await findDuplicateGames(mockDb as never);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ winnerId: 5, loserIds: [6] });
  });

  // ROK-1053 item 4: the mocks above previously omitted `igdb_ids` entirely,
  // so `igdbIds` was always empty and the first two winner-selection branches
  // (IGDB+ITAD, then IGDB-only) never ran. These cover the full precedence.

  it('prefers the row carrying BOTH igdb and itad ids', async () => {
    const steamDups = [
      {
        key_val: 500,
        ids: [30, 31, 32],
        itad_ids: [30, 31, null],
        igdb_ids: [null, 31, null],
      },
    ];

    mockDb.execute.mockResolvedValueOnce(steamDups);
    mockDb.execute.mockResolvedValueOnce([]);

    const result = await findDuplicateGames(mockDb as never);

    // 31 is the only row present in both source systems; 30 is ITAD-only.
    expect(result[0]?.winnerId).toBe(31);
    expect(result[0]?.loserIds).toEqual(expect.arrayContaining([30, 32]));
  });

  it('prefers an igdb-only row over an itad-only row', async () => {
    const steamDups = [
      {
        key_val: 600,
        ids: [40, 41],
        itad_ids: [40, null],
        igdb_ids: [null, 41],
      },
    ];

    mockDb.execute.mockResolvedValueOnce(steamDups);
    mockDb.execute.mockResolvedValueOnce([]);

    const result = await findDuplicateGames(mockDb as never);

    // Precedence is IGDB+ITAD > IGDB > ITAD, so the IGDB row wins outright.
    expect(result[0]).toEqual({ winnerId: 41, loserIds: [40] });
  });

  it('handles multiple losers in a single group', async () => {
    const steamDups = [
      {
        key_val: 200,
        ids: [10, 11, 12],
        itad_ids: [10, null, null],
        igdb_ids: [],
      },
    ];

    mockDb.execute.mockResolvedValueOnce(steamDups);
    mockDb.execute.mockResolvedValueOnce([]);

    const result = await findDuplicateGames(mockDb as never);

    expect(result).toHaveLength(1);
    expect(result[0]?.winnerId).toBe(10);
    expect(result[0]?.loserIds).toEqual(expect.arrayContaining([11, 12]));
    expect(result[0]?.loserIds).toHaveLength(2);
  });

  it('deduplicates overlapping groups that share a winner', async () => {
    // Both steam and igdb find the same pair as duplicates
    const steamDups = [
      { key_val: 300, ids: [20, 21], itad_ids: [20, null], igdb_ids: [] },
    ];
    const igdbDups = [
      { key_val: 400, ids: [20, 22], itad_ids: [20, null], igdb_ids: [] },
    ];

    mockDb.execute.mockResolvedValueOnce(steamDups);
    mockDb.execute.mockResolvedValueOnce(igdbDups);

    const result = await findDuplicateGames(mockDb as never);

    // Should merge into a single group with winner=20
    expect(result).toHaveLength(1);
    expect(result[0]?.winnerId).toBe(20);
    expect(result[0]?.loserIds).toEqual(expect.arrayContaining([21, 22]));
    expect(result[0]?.loserIds).toHaveLength(2);
  });
});

// ─── mergeAndDeleteDuplicates ─────────────────────────────────────────────

describe('mergeAndDeleteDuplicates', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns merged count for successfully processed groups', async () => {
    const groups = [makeGroup(1, [2]), makeGroup(3, [4, 5])];

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
    const groups = [makeGroup(1, [2]), makeGroup(3, [4]), makeGroup(5, [6])];

    // First group succeeds (default transaction mock works)
    // Second group: make the transaction throw
    let callCount = 0;
    mockDb.transaction.mockImplementation(
      (fn: (tx: unknown) => Promise<void>) => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('FK constraint violation'));
        }
        return fn(mockDb);
      },
    );

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
    const groups = [makeGroup(1, [2]), makeGroup(3, [4]), makeGroup(5, [6])];

    const result = await mergeAndDeleteDuplicates(mockDb as never, groups);

    expect(result.merged).toBe(3);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── ROK-1680: name-dedup carry of steam_app_id_source ────────────────────

describe('mergeNameDuplicates — steamAppIdSource carry (ROK-1680)', () => {
  const winnerRow = {
    id: 1,
    name: 'Carry Game',
    igdbId: 10,
    steamAppId: null,
    itadGameId: null,
  };
  const loserRow = {
    id: 2,
    name: 'Carry Game',
    igdbId: null,
    steamAppId: 500,
    itadGameId: 'itad-carry',
  };

  /** Drive one winner+loser name group; return the carry UPDATE's patch. */
  async function runCarry(winnerSteamAppId: number | null) {
    const mockDb = createDrizzleMock();
    // selectAllRows awaits `.from()`; the carry reads end in `.limit()`.
    mockDb.from.mockResolvedValueOnce([winnerRow, loserRow]);
    mockDb.limit
      .mockResolvedValueOnce([
        {
          steamAppId: 500,
          itadGameId: 'itad-carry',
          coverUrl: null,
          steamAppIdSource: 'itad',
        },
      ])
      .mockResolvedValueOnce([
        { steamAppId: winnerSteamAppId, itadGameId: null, coverUrl: null },
      ]);
    const result = await mergeNameDuplicates(mockDb as never);
    expect(result.errors).toEqual([]);
    const calls = mockDb.set.mock.calls;
    return calls.length ? (calls[calls.length - 1][0] as object) : undefined;
  }

  it("carries the loser's source with its steamAppId when the winner has none", async () => {
    const patch = await runCarry(null);
    expect(patch).toEqual(
      expect.objectContaining({ steamAppId: 500, steamAppIdSource: 'itad' }),
    );
  });

  it('never carries the source alone when the winner already has a steamAppId', async () => {
    const patch = await runCarry(999);
    expect(patch).toEqual(
      expect.objectContaining({ itadGameId: 'itad-carry' }),
    );
    expect(patch).not.toHaveProperty('steamAppIdSource');
    expect(patch).not.toHaveProperty('steamAppId');
  });
});

// ─── Binding-change listener: merges announce rewritten bindings ──────────

/** Render a mocked `execute` argument to SQL text ('' when it is not SQL). */
function renderSql(arg: unknown): { sql: string; params: unknown[] } {
  if (!arg || typeof arg !== 'object' || !('queryChunks' in arg)) {
    return { sql: '', params: [] };
  }
  return new PgDialect().sqlToQuery(arg as SQL);
}

/** Every binding-channel read the merge issued, as rendered queries. */
function bindingReads(mockDb: MockDb): { sql: string; params: unknown[] }[] {
  return mockDb.execute.mock.calls
    .map(([arg]: unknown[]) => renderSql(arg))
    .filter((q) => q.sql.includes('SELECT DISTINCT channel_id'));
}

/** Make the mock transaction record when it resolves, to assert ordering. */
function recordTxResolution(mockDb: MockDb, order: string[]): void {
  mockDb.transaction.mockImplementation(
    async (cb: (tx: MockDb) => Promise<unknown>) => {
      const out = await cb(mockDb);
      order.push('tx-resolved');
      return out;
    },
  );
}

/** Run the tx body (so the read collects ids), then fail the commit. */
function failCommit(mockDb: MockDb): void {
  mockDb.transaction.mockImplementation(
    async (cb: (tx: MockDb) => Promise<unknown>) => {
      await cb(mockDb);
      throw new Error('commit failed');
    },
  );
}

/** A listener that logs each call into `order`. */
function orderListener(order: string[]): jest.Mock<void, [string[]]> {
  return jest.fn((ids: string[]) => {
    order.push(`listener:${ids.join(',')}`);
  });
}

describe('mergeAndDeleteDuplicates — binding-change listener', () => {
  let mockDb: MockDb;
  let order: string[];
  let listener: jest.Mock<void, [string[]]>;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    order = [];
    recordTxResolution(mockDb, order);
    listener = orderListener(order);
    // The loser's binding read is the first execute() of its merge.
    mockDb.execute.mockResolvedValueOnce([
      { channel_id: 'ch-1' },
      { channel_id: 'ch-2' },
    ]);
  });

  it("announces the loser's bound channels once, after the tx resolved", async () => {
    const result = await mergeAndDeleteDuplicates(
      mockDb as never,
      [makeGroup(1, [2])],
      listener,
    );

    expect(result).toEqual({ merged: 1, errors: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(['ch-1', 'ch-2']);
    expect(order).toEqual(['tx-resolved', 'listener:ch-1,ch-2']);
    // It read the LOSER's bindings (id 2), not the winner's.
    expect(bindingReads(mockDb).map((q) => q.params)).toEqual([[2]]);
  });

  it('never announces when the transaction rejects, and reports the group', async () => {
    failCommit(mockDb);

    const result = await mergeAndDeleteDuplicates(
      mockDb as never,
      [makeGroup(1, [2])],
      listener,
    );

    expect(listener).not.toHaveBeenCalled();
    expect(result.merged).toBe(0);
    expect(result.errors).toEqual([expect.stringContaining('commit failed')]);
  });

  it('keeps a committed merge counted when the listener throws', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    listener.mockImplementation(() => {
      throw new Error('listener blew up');
    });

    const result = await mergeAndDeleteDuplicates(
      mockDb as never,
      [makeGroup(1, [2])],
      listener,
    );

    expect(result).toEqual({ merged: 1, errors: [] });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Binding-change listener failed'),
    );
    warn.mockRestore();
  });
});

describe('mergeAndDeleteDuplicates — a binding read with no row list', () => {
  it('fails the group loudly instead of announcing nothing', async () => {
    const mockDb = createDrizzleMock();
    const listener = jest.fn();
    // A node-postgres-style envelope, not the row list postgres.js resolves.
    mockDb.execute.mockResolvedValueOnce({ rows: [{ channel_id: 'ch-1' }] });

    const result = await mergeAndDeleteDuplicates(
      mockDb as never,
      [makeGroup(1, [2])],
      listener,
    );

    expect(result).toEqual({
      merged: 0,
      errors: [expect.stringContaining('winner=1')],
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('mergeAndDeleteDuplicates — nothing to announce', () => {
  it('stays silent for a group whose losers hold no bindings', async () => {
    const listener = jest.fn();

    await mergeAndDeleteDuplicates(
      createDrizzleMock() as never,
      [makeGroup(1, [2])],
      listener,
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it('issues no binding read when no listener is passed', async () => {
    const mockDb = createDrizzleMock();

    await mergeAndDeleteDuplicates(mockDb as never, [makeGroup(1, [2])]);

    expect(bindingReads(mockDb)).toEqual([]);
  });
});

describe('mergeNameDuplicates — binding-change listener', () => {
  let mockDb: MockDb;
  let order: string[];

  beforeEach(() => {
    mockDb = createDrizzleMock();
    order = [];
    // selectAllRows awaits `.from()`; id 1 carries the igdbId, so it wins.
    mockDb.from.mockResolvedValueOnce([
      {
        id: 1,
        name: 'Bound Game',
        igdbId: 10,
        steamAppId: null,
        itadGameId: null,
      },
      {
        id: 2,
        name: 'Bound Game',
        igdbId: null,
        steamAppId: null,
        itadGameId: null,
      },
    ]);
    // Carry reads (loser, then winner) end in `.limit()`; nothing to carry.
    mockDb.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockDb.execute.mockResolvedValueOnce([
      { channel_id: 'ch-9' },
      { channel_id: 'ch-8' },
    ]);
  });

  it("announces the loser's bound channels once, after the tx resolved", async () => {
    recordTxResolution(mockDb, order);
    const listener = orderListener(order);

    const result = await mergeNameDuplicates(mockDb as never, listener);

    expect(result.errors).toEqual([]);
    expect(result.merged).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(['ch-9', 'ch-8']);
    expect(order).toEqual(['tx-resolved', 'listener:ch-9,ch-8']);
    expect(bindingReads(mockDb).map((q) => q.params)).toEqual([[2]]);
  });

  it('never announces when the transaction rejects, and reports the group', async () => {
    failCommit(mockDb);
    const listener = orderListener(order);

    const result = await mergeNameDuplicates(mockDb as never, listener);

    expect(listener).not.toHaveBeenCalled();
    expect(result.merged).toBe(0);
    expect(result.errors).toEqual([expect.stringContaining('commit failed')]);
  });
});
