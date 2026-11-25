/**
 * Unit tests for the unfurl tracking-row cap (TDB L2847).
 *
 * Every tracked `discord_event_messages` row is re-edited on each signup, so
 * link spam must not grow the tracked set for one event without bound.
 */
import {
  insertUnfurlTrackingRow,
  MAX_TRACKED_MESSAGES_PER_EVENT,
} from './event-link-track.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type { EmbedEventData } from '../services/discord-embed.factory';

const target = { guildId: 'g-1', channelId: 'c-1', messageId: 'm-1' };
const data: EmbedEventData = {
  id: 42,
  title: 'Raid',
  startTime: '2099-01-01T20:00:00.000Z',
  endTime: '2099-01-01T23:00:00.000Z',
  signupCount: 0,
};

describe('insertUnfurlTrackingRow — per-event cap', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('caps tracked messages per event at 10', () => {
    expect(MAX_TRACKED_MESSAGES_PER_EVENT).toBe(10);
  });

  it('inserts a tracking row while the event is under the cap', async () => {
    db.where.mockResolvedValueOnce([{ n: MAX_TRACKED_MESSAGES_PER_EVENT - 1 }]);
    const tracked = await insertUnfurlTrackingRow(
      db as never,
      target,
      42,
      data,
    );
    expect(tracked).toBe(true);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 42, messageId: 'm-1' }),
    );
  });

  it('skips tracking once the event already has the cap of tracked rows', async () => {
    db.where.mockResolvedValueOnce([{ n: MAX_TRACKED_MESSAGES_PER_EVENT }]);
    const tracked = await insertUnfurlTrackingRow(
      db as never,
      target,
      42,
      data,
    );
    expect(tracked).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('treats a string count from postgres as a number', async () => {
    db.where.mockResolvedValueOnce([
      { n: String(MAX_TRACKED_MESSAGES_PER_EVENT + 3) },
    ]);
    const tracked = await insertUnfurlTrackingRow(
      db as never,
      target,
      42,
      data,
    );
    expect(tracked).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
