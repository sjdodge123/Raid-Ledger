/**
 * Unit tests for voice-attendance-classify helpers.
 *
 * shouldClassifyEvent truth table (ROK-943):
 *   Case 1: no unclassified, no signups           => false
 *   Case 2: no unclassified, signups, 0 sessions  => true  (needs no_show creation)
 *   Case 3: no unclassified, signups, >0 sessions => true  (was BUG in ROK-943, now fixed)
 *   Case 4: has unclassified, no signups           => true
 *   Case 5: has unclassified, has signups          => true
 *
 * ROK-985 additions:
 *   loadAndFilterSessions — no orphan deletion, dual-identifier matching
 *   autoPopulateAttendance — userId fallback for attendance updates
 *   shouldClassifyEvent — logger param, logs reason on false
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  shouldClassifyEvent,
  loadAndFilterSessions,
  autoPopulateAttendance,
  classifyEventSessions,
} from './voice-attendance-classify.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

describe('shouldClassifyEvent', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('returns false when no unclassified sessions and no signups', async () => {
    // Query 1: unclassified count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    // Query 2: signup count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    expect(result).toBe(false);
  });

  it('returns true when no unclassified sessions but signups exist with zero total sessions', async () => {
    // Query 1: unclassified count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    // Query 2: signup count => 3
    mockDb.where.mockResolvedValueOnce([{ count: 3 }]);
    // Query 3: total session count => 0 (no voice data at all, needs no_show creation)
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    expect(result).toBe(true);
  });

  it('returns true when all sessions classified but signups exist (THE BUG — ROK-943)', async () => {
    // Query 1: unclassified count => 0 (all sessions already classified)
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    // Query 2: signup count => 5 (signups exist that may need no_show creation)
    mockDb.where.mockResolvedValueOnce([{ count: 5 }]);
    // Query 3: total session count => 2 (sessions exist, all classified)
    mockDb.where.mockResolvedValueOnce([{ count: 2 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    // The pipeline must re-run to create no_show entries for signups
    // without voice sessions. The current code returns false here — BUG.
    expect(result).toBe(true);
  });

  it('returns true when unclassified sessions exist but no signups', async () => {
    // Query 1: unclassified count => 4
    mockDb.where.mockResolvedValueOnce([{ count: 4 }]);
    // Query 2: signup count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    expect(result).toBe(true);
  });

  it('returns true when both unclassified sessions and signups exist', async () => {
    // Query 1: unclassified count => 2
    mockDb.where.mockResolvedValueOnce([{ count: 2 }]);
    // Query 2: signup count => 3
    mockDb.where.mockResolvedValueOnce([{ count: 3 }]);

    const result = await shouldClassifyEvent(mockDb as never, 1);

    expect(result).toBe(true);
  });

  it('calls logger.log with the reason when returning false (ROK-985)', async () => {
    // Query 1: unclassified count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    // Query 2: signup count => 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    const mockLogger = { log: jest.fn(), warn: jest.fn() };

    await shouldClassifyEvent(mockDb as never, 42, mockLogger);

    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('42'));
  });
});

// ─── loadAndFilterSessions (ROK-985) ──────────────────────────────────────

describe('loadAndFilterSessions', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('never deletes voice sessions — returns unmatched as partition only', async () => {
    // Query 1: all voice sessions for event
    const session1 = {
      id: 'uuid-matched',
      eventId: 1,
      discordUserId: '111',
      userId: 10,
    };
    const session2 = {
      id: 'uuid-orphan',
      eventId: 1,
      discordUserId: '999',
      userId: null,
    };
    mockDb.where.mockResolvedValueOnce([session1, session2]);
    // Query 2: signups with discordUserId for matching
    mockDb.where.mockResolvedValueOnce([{ discordUserId: '111', userId: 10 }]);

    await loadAndFilterSessions(mockDb as never, 1);

    // The function must NOT call db.delete()
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('matches sessions by userId when signup has userId but no discordUserId', async () => {
    // Voice session recorded for discordUserId '555', userId 10
    const session = {
      id: 'uuid-1',
      eventId: 1,
      discordUserId: '555',
      userId: 10,
    };
    mockDb.where.mockResolvedValueOnce([session]);
    // Signups: one signup with userId=10 but discordUserId=null
    mockDb.where.mockResolvedValueOnce([{ discordUserId: null, userId: 10 }]);

    const result = await loadAndFilterSessions(mockDb as never, 1);

    // The session should match via userId fallback
    expect(result.sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'uuid-1' })]),
    );
  });
});

// ─── autoPopulateAttendance (ROK-985) ─────────────────────────────────────

describe('autoPopulateAttendance', () => {
  let mockDb: MockDb;
  const mockLogger = { log: jest.fn(), warn: jest.fn() };

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockLogger.log.mockClear();
    mockLogger.warn.mockClear();
  });

  it('makes a userId-based update call for sessions that have userId (ROK-985)', async () => {
    // Session has userId=10 — the function should issue an update
    // that matches signups by userId (not just by discordUserId).
    // Currently batchUpdateAttendance only extracts discordUserId
    // and the WHERE clause uses discordUserId IN (...), so signups
    // where discordUserId IS NULL but userId=10 are never updated.
    const session = {
      id: 'uuid-1',
      eventId: 1,
      discordUserId: '555',
      userId: 10,
      classification: 'full',
    };
    mockDb.where
      .mockResolvedValueOnce([session]) // classified sessions query
      .mockResolvedValue([]); // subsequent update queries

    await autoPopulateAttendance(mockDb as never, 1, mockLogger);

    // After the fix, there should be at least 2 update calls:
    // one matching by discordUserId, one matching by userId.
    // Currently only 1 update call is made (discordUserId only).
    expect(mockDb.update.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── classifyEventSessions — forward-only (ROK-1940 D10) ──────────────────

describe('classifyEventSessions — never rewrites a classified row', () => {
  let mockDb: MockDb;
  const logger = { log: jest.fn(), warn: jest.fn() };
  const start = new Date('2026-11-01T20:00:00Z');
  const end = new Date('2026-11-01T22:00:00Z');
  const event = { id: 7, duration: [start, end] } as never;
  const at = (min: number): Date => new Date(start.getTime() + min * 60_000);

  /** A voice row 6 min late with 120 s of presence (the Codex P2 example). */
  const row = (id: string, classification: string | null) => ({
    id,
    eventId: 7,
    userId: null,
    discordUserId: `d-${id}`,
    discordUsername: id,
    firstJoinAt: at(6),
    lastLeaveAt: at(8),
    totalDurationSec: 120,
    segments: [],
    classification,
  });

  /** Ids handed to the classification UPDATE's CASE (WHEN id = $n THEN $n+1). */
  const classifiedIds = (): unknown[] => {
    const call = mockDb.set.mock.calls[0] as
      [{ classification: SQL }] | undefined;
    if (!call) throw new Error('expected a classification UPDATE, got none');
    const { params } = new PgDialect().sqlToQuery(call[0].classification);
    return params.filter((_, i) => i % 2 === 0);
  };

  /** Queue: sessions select, signup ids, (update), no-show signups. */
  const run = async (rows: ReturnType<typeof row>[]) => {
    mockDb.where
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    await classifyEventSessions(mockDb as never, 7, event, 10 * 60_000, logger);
  };

  beforeEach(() => {
    mockDb = createDrizzleMock();
    logger.log.mockClear();
  });

  it('a completed event (every row classified) issues no classification UPDATE', async () => {
    await run([row('A', 'late'), row('B', 'no_show')]);

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Classified 0 voice session(s) for event 7'),
    );
  });

  it('a mixed event classifies only the NULL row; the classified row is not in the UPDATE', async () => {
    await run([row('A', 'late'), row('B', null)]);

    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(classifiedIds()).toEqual(['B']);
  });

  it('a fresh event (all NULL) classifies every row', async () => {
    await run([row('A', null), row('B', null)]);

    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(classifiedIds()).toEqual(['A', 'B']);
  });
});
