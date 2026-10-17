/**
 * Tests for snapshot diagnostic logging added in ROK-842.
 * AC 2: Snapshot logs when voice channel resolution returns null for an event.
 */
import {
  runEventSnapshots,
  type RecentlyStartedEvent,
} from './voice-attendance-snapshot.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

describe('runEventSnapshots — null channel resolution logging (ROK-842)', () => {
  const now = new Date('2026-03-17T20:00:00Z');
  const windowMs = 2 * 60 * 1000;

  let snapshotted: Set<number>;
  let mockResolveVoiceChannel: jest.Mock;
  let mockSnapshotEvent: jest.Mock;
  let mockLogger: { log: jest.Mock };
  let mockDb: MockDb;

  beforeEach(() => {
    snapshotted = new Set();
    mockResolveVoiceChannel = jest.fn();
    mockSnapshotEvent = jest.fn().mockReturnValue(0);
    mockLogger = { log: jest.fn() };
    mockDb = createDrizzleMock();
  });

  async function runWithEvents(events: RecentlyStartedEvent[]): Promise<void> {
    mockDb.where.mockResolvedValueOnce(events);
    await runEventSnapshots(
      mockDb as never,
      now,
      windowMs,
      snapshotted,
      mockResolveVoiceChannel,
      mockSnapshotEvent,
      mockLogger,
    );
  }

  it('logs when voice channel resolution returns null (AC2)', async () => {
    mockResolveVoiceChannel.mockResolvedValue(null);

    await runWithEvents([{ id: 100, gameId: null, recurrenceGroupId: null }]);

    expect(mockLogger.log).toHaveBeenCalledTimes(1);
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('no voice channel resolved'),
    );
  });

  it('log message includes the eventId when resolution returns null (AC2)', async () => {
    mockResolveVoiceChannel.mockResolvedValue(null);

    await runWithEvents([{ id: 200, gameId: 5, recurrenceGroupId: 'grp-1' }]);

    const [logMsg] = mockLogger.log.mock.calls[0];
    expect(logMsg).toContain('eventId=200');
  });

  it('logs once per unresolved event in a batch', async () => {
    mockResolveVoiceChannel.mockResolvedValue(null);

    await runWithEvents([
      { id: 300, gameId: null, recurrenceGroupId: null },
      { id: 301, gameId: null, recurrenceGroupId: null },
    ]);

    // Two events, two null resolutions → two log calls
    expect(mockLogger.log).toHaveBeenCalledTimes(2);
  });

  it('does NOT log the null-resolution message when channel resolves successfully', async () => {
    mockResolveVoiceChannel.mockResolvedValue('voice-ch-ok');
    mockSnapshotEvent.mockReturnValue(0);

    await runWithEvents([{ id: 400, gameId: null, recurrenceGroupId: null }]);

    const logCalls = mockLogger.log.mock.calls.map((c) => c[0] as string);
    const hasNullMsg = logCalls.some((m) =>
      m.includes('no voice channel resolved'),
    );
    expect(hasNullMsg).toBe(false);
  });

  it('logs null-resolution for failed event but not for successful event in same batch', async () => {
    mockResolveVoiceChannel
      .mockResolvedValueOnce(null) // event 500 → null
      .mockResolvedValueOnce('voice-ch-b'); // event 501 → ok
    mockSnapshotEvent.mockReturnValue(3);

    await runWithEvents([
      { id: 500, gameId: null, recurrenceGroupId: null },
      { id: 501, gameId: null, recurrenceGroupId: null },
    ]);

    const logCalls = mockLogger.log.mock.calls.map((c) => c[0] as string);
    const nullLogs = logCalls.filter((m) =>
      m.includes('no voice channel resolved'),
    );
    expect(nullLogs).toHaveLength(1);
    expect(nullLogs[0]).toContain('eventId=500');
  });
});
