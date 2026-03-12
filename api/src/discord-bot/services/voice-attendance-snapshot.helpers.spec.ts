/**
 * Tests for voice-attendance-snapshot.helpers.ts (ROK-785).
 * Covers snapshot resilience: failed channel resolution should allow retries.
 */
import {
  runEventSnapshots,
  fetchRecentlyStartedEvents,
  type RecentlyStartedEvent,
} from './voice-attendance-snapshot.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

describe('runEventSnapshots', () => {
  const mockLogger = { log: jest.fn() };
  const now = new Date('2026-03-12T20:00:00Z');
  const windowMs = 2 * 60 * 1000;

  let snapshotted: Set<number>;
  let mockResolveVoiceChannel: jest.Mock;
  let mockSnapshotEvent: jest.Mock;
  let mockDb: MockDb;

  beforeEach(() => {
    snapshotted = new Set();
    mockResolveVoiceChannel = jest.fn();
    mockSnapshotEvent = jest.fn().mockReturnValue(0);
    mockLogger.log.mockReset();
    mockDb = createDrizzleMock();
  });

  /** Helper: run snapshots with pre-set events (bypasses DB query). */
  async function runWithEvents(events: RecentlyStartedEvent[]): Promise<void> {
    // Mock the DB query to return our events
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

  it('skips already-snapshotted events', async () => {
    snapshotted.add(1);
    await runWithEvents([{ id: 1, gameId: null, recurrenceGroupId: null }]);

    expect(mockResolveVoiceChannel).not.toHaveBeenCalled();
  });

  it('marks event as snapshotted after successful resolution', async () => {
    mockResolveVoiceChannel.mockResolvedValue('voice-ch-1');
    mockSnapshotEvent.mockReturnValue(3);

    await runWithEvents([{ id: 2, gameId: 5, recurrenceGroupId: 'grp-1' }]);

    expect(snapshotted.has(2)).toBe(true);
    expect(mockSnapshotEvent).toHaveBeenCalledWith(2, 'voice-ch-1');
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('3 pre-joined'),
    );
  });

  it('does NOT mark snapshotted when channel resolution returns null (ROK-785)', async () => {
    mockResolveVoiceChannel.mockResolvedValue(null);

    await runWithEvents([{ id: 3, gameId: null, recurrenceGroupId: null }]);

    expect(snapshotted.has(3)).toBe(false);
    expect(mockSnapshotEvent).not.toHaveBeenCalled();
  });

  it('allows retry after failed resolution (ROK-785)', async () => {
    // First attempt: channel not found
    mockResolveVoiceChannel.mockResolvedValue(null);
    await runWithEvents([{ id: 4, gameId: null, recurrenceGroupId: null }]);
    expect(snapshotted.has(4)).toBe(false);

    // Second attempt: channel now available
    mockResolveVoiceChannel.mockResolvedValue('voice-ch-retry');
    mockSnapshotEvent.mockReturnValue(2);
    await runWithEvents([{ id: 4, gameId: null, recurrenceGroupId: null }]);
    expect(snapshotted.has(4)).toBe(true);
    expect(mockSnapshotEvent).toHaveBeenCalledWith(4, 'voice-ch-retry');
  });

  it('tracks each event independently — partial failures do not block others (ROK-785)', async () => {
    // Event 5: channel resolves → snapshotted
    // Event 6: channel returns null → NOT snapshotted (retry possible)
    // Event 7: channel resolves with 0 members → still snapshotted
    mockResolveVoiceChannel
      .mockResolvedValueOnce('voice-ch-A') // event 5
      .mockResolvedValueOnce(null) // event 6
      .mockResolvedValueOnce('voice-ch-C'); // event 7
    mockSnapshotEvent
      .mockReturnValueOnce(3) // event 5: 3 members
      .mockReturnValueOnce(0); // event 7: 0 members

    await runWithEvents([
      { id: 5, gameId: 1, recurrenceGroupId: null },
      { id: 6, gameId: 2, recurrenceGroupId: null },
      { id: 7, gameId: null, recurrenceGroupId: null },
    ]);

    expect(snapshotted.has(5)).toBe(true);
    expect(snapshotted.has(6)).toBe(false); // null channel — should NOT be marked
    expect(snapshotted.has(7)).toBe(true); // 0 members but channel resolved → marked
    expect(mockSnapshotEvent).toHaveBeenCalledTimes(2);
  });

  it('zero-member snapshot still marks event as snapshotted (ROK-785)', async () => {
    // Channel resolves but is empty. The event is still marked as snapshotted
    // to prevent redundant re-processing on the next cron tick.
    mockResolveVoiceChannel.mockResolvedValue('voice-ch-empty');
    mockSnapshotEvent.mockReturnValue(0);

    await runWithEvents([{ id: 8, gameId: null, recurrenceGroupId: null }]);

    expect(snapshotted.has(8)).toBe(true);
    expect(mockSnapshotEvent).toHaveBeenCalledWith(8, 'voice-ch-empty');
    // No log call when count is 0
    expect(mockLogger.log).not.toHaveBeenCalled();
  });

  it('resolveVoiceChannel throwing an error does not mark event as snapshotted', async () => {
    // If resolveVoiceChannel rejects (network error, Discord API failure),
    // the event should propagate the error (not silently mark as done).
    mockResolveVoiceChannel.mockRejectedValue(new Error('Discord API timeout'));

    await expect(
      runWithEvents([{ id: 9, gameId: 1, recurrenceGroupId: 'rg-1' }]),
    ).rejects.toThrow('Discord API timeout');

    expect(snapshotted.has(9)).toBe(false);
    expect(mockSnapshotEvent).not.toHaveBeenCalled();
  });

  it('does not log when channel is resolved but snapshotEvent returns 0', async () => {
    mockResolveVoiceChannel.mockResolvedValue('voice-ch-present');
    mockSnapshotEvent.mockReturnValue(0);

    await runWithEvents([{ id: 10, gameId: null, recurrenceGroupId: null }]);

    // count === 0 → no log message (only log when count > 0)
    expect(mockLogger.log).not.toHaveBeenCalled();
  });

  it('processes all events even when one is in the snapshotted set mid-batch', async () => {
    // Pre-snapshot event 11, leave event 12 unsnapshotted.
    // Both appear in the batch — only event 12 should be processed.
    snapshotted.add(11);
    mockResolveVoiceChannel.mockResolvedValue('voice-ch-12');
    mockSnapshotEvent.mockReturnValue(1);

    await runWithEvents([
      { id: 11, gameId: null, recurrenceGroupId: null },
      { id: 12, gameId: null, recurrenceGroupId: null },
    ]);

    expect(mockSnapshotEvent).toHaveBeenCalledTimes(1);
    expect(mockSnapshotEvent).toHaveBeenCalledWith(12, 'voice-ch-12');
    expect(snapshotted.has(11)).toBe(true); // unchanged
    expect(snapshotted.has(12)).toBe(true); // newly added
  });
});

describe('fetchRecentlyStartedEvents', () => {
  it('is exported as a function', () => {
    expect(typeof fetchRecentlyStartedEvents).toBe('function');
  });
});
