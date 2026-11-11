/**
 * ROK-2174: the voice-attendance flush writes ONE multi-row upsert per tick
 * (chunked), and falls back to the per-row path when that statement fails.
 */
import {
  FLUSH_UPSERT_CHUNK,
  flushDirtySessions,
} from './voice-attendance-flush-write.helpers';
import type { InMemorySession } from './voice-attendance.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

function makeLogger() {
  return { error: jest.fn(), debug: jest.fn(), warn: jest.fn() };
}

function makeSession(n: number, over: Partial<InMemorySession> = {}) {
  const session: InMemorySession = {
    eventId: 1,
    userId: n,
    discordUserId: `discord-${n}`,
    discordUsername: `User${n}`,
    discordAvatarHash: null,
    firstJoinAt: new Date('2026-02-28T20:00:00Z'),
    lastLeaveAt: new Date('2026-02-28T20:10:00Z'),
    totalDurationSec: 600,
    segments: [
      {
        joinAt: '2026-02-28T20:00:00.000Z',
        leaveAt: '2026-02-28T20:10:00.000Z',
        durationSec: 600,
      },
    ],
    isActive: false,
    activeSegmentStart: null,
    dirty: true,
    ...over,
  };
  return session;
}

function toMap(sessions: InMemorySession[]): Map<string, InMemorySession> {
  return new Map(sessions.map((s) => [`${s.eventId}:${s.discordUserId}`, s]));
}

describe('flushDirtySessions — batched upsert (ROK-2174)', () => {
  let mockDb: MockDb;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockDb.onConflictDoUpdate.mockResolvedValue(undefined);
    logger = makeLogger();
  });

  it('issues ONE statement carrying every dirty or active session', async () => {
    const sessions = [makeSession(1), makeSession(2), makeSession(3)];
    await flushDirtySessions(mockDb as never, toMap(sessions), logger);

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const rows: Array<Record<string, unknown>> = mockDb.values.mock.calls[0][0];
    expect(rows.map((r) => r.discordUserId)).toEqual([
      'discord-1',
      'discord-2',
      'discord-3',
    ]);
    expect(rows[1]).toEqual({
      eventId: 1,
      userId: 2,
      discordUserId: 'discord-2',
      discordUsername: 'User2',
      firstJoinAt: new Date('2026-02-28T20:00:00Z'),
      lastLeaveAt: new Date('2026-02-28T20:10:00Z'),
      totalDurationSec: 600,
      segments: sessions[1]?.segments,
    });
    expect(sessions.every((s) => !s.dirty)).toBe(true);
  });

  it('skips clean, inactive sessions and writes nothing for an empty tick', async () => {
    const clean = makeSession(1, { dirty: false, isActive: false });
    await flushDirtySessions(mockDb as never, toMap([clean]), logger);
    await flushDirtySessions(mockDb as never, new Map(), logger);

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.values).not.toHaveBeenCalled();
  });

  it('splits a tick larger than FLUSH_UPSERT_CHUNK into chunked statements', async () => {
    const sessions = Array.from({ length: FLUSH_UPSERT_CHUNK + 1 }, (_, i) =>
      makeSession(i),
    );
    await flushDirtySessions(mockDb as never, toMap(sessions), logger);

    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(mockDb.values.mock.calls[0][0]).toHaveLength(FLUSH_UPSERT_CHUNK);
    expect(mockDb.values.mock.calls[1][0]).toHaveLength(1);
  });

  it('writes rows in (eventId, discordUserId) order whatever the Map order', async () => {
    const sessions = [
      makeSession(1, { eventId: 2, discordUserId: 'a' }),
      makeSession(2, { eventId: 1, discordUserId: 'c' }),
      makeSession(3, { eventId: 1, discordUserId: 'b' }),
    ];
    await flushDirtySessions(mockDb as never, toMap(sessions), logger);

    expect(mockDb.values).toHaveBeenCalledTimes(1);
    const rows: Array<{ eventId: number; discordUserId: string }> =
      mockDb.values.mock.calls[0]?.[0] ?? [];
    expect(rows.map((r) => `${r.eventId}:${r.discordUserId}`)).toEqual([
      '1:b',
      '1:c',
      '2:a',
    ]);
  });

  it('falls back to one upsert per row when the batch fails; good rows still land', async () => {
    mockDb.onConflictDoUpdate
      .mockRejectedValueOnce(new Error('batch boom')) // the batch
      .mockResolvedValueOnce(undefined) // row 1
      .mockRejectedValueOnce(new Error('row 2 boom')) // row 2
      .mockResolvedValueOnce(undefined); // row 3
    const sessions = [makeSession(1), makeSession(2), makeSession(3)];
    await flushDirtySessions(mockDb as never, toMap(sessions), logger);

    // 1 batch attempt + 3 per-row retries
    expect(mockDb.insert).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain('retrying per row');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(sessions.map((s) => s.dirty)).toEqual([false, true, false]);
  });
});
