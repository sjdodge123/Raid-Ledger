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
});

describe('fetchRecentlyStartedEvents', () => {
  it('is exported as a function', () => {
    expect(typeof fetchRecentlyStartedEvents).toBe('function');
  });
});
