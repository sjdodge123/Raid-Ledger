/**
 * ROK-2314 review MAJOR-1 — `EventPostReopener` (unit): moves the hub
 * thread's `write_closes_at` and the registry post's `closes_at` to the
 * moved event FIRST, then flips the lock, so a post whose OLD close had
 * passed is not read as past close.
 */
import { EventPostReopener } from './event-post-reopener';
import type { EventPlanningPostsService } from './event-planning-posts.service';
import type { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const mockSyncEventDiscussion = jest.fn();
jest.mock('../event-discussion/event-discussion.sync', () => ({
  syncEventDiscussion: (...a: unknown[]): unknown =>
    mockSyncEventDiscussion(...a),
}));

function setup() {
  const db = {} as ForumDiscordDb;
  const service = { syncEvent: jest.fn().mockResolvedValue(undefined) };
  const lock = { sweepEvent: jest.fn().mockResolvedValue(1) };
  const reopener = new EventPostReopener(
    db,
    service as unknown as EventPlanningPostsService,
    lock as unknown as HubForumDiscordEventLockSweep,
  );
  return { db, reopener, service, lock };
}

beforeEach(() => {
  mockSyncEventDiscussion.mockReset().mockResolvedValue('updated');
});

describe('EventPostReopener.reopenEventPost (ROK-2314)', () => {
  it('re-syncs the hub thread and registry post before flipping the lock', async () => {
    const { db, reopener, service, lock } = setup();
    await reopener.reopenEventPost(42);
    expect(mockSyncEventDiscussion).toHaveBeenCalledWith(db, 42);
    expect(service.syncEvent).toHaveBeenCalledWith(42);
    expect(lock.sweepEvent).toHaveBeenCalledWith(42);
    const flip = lock.sweepEvent.mock.invocationCallOrder[0] ?? -Infinity;
    expect(
      mockSyncEventDiscussion.mock.invocationCallOrder[0] ?? Infinity,
    ).toBeLessThan(flip);
    expect(
      service.syncEvent.mock.invocationCallOrder[0] ?? Infinity,
    ).toBeLessThan(flip);
  });

  it('still flips the lock when a re-sync throws', async () => {
    const { reopener, service, lock } = setup();
    mockSyncEventDiscussion.mockRejectedValueOnce(new Error('db'));
    service.syncEvent.mockRejectedValueOnce(new Error('discord'));
    await reopener.reopenEventPost(42);
    expect(lock.sweepEvent).toHaveBeenCalledWith(42);
  });

  it('rethrows a failed flip so the caller logs it', async () => {
    const { reopener, lock } = setup();
    lock.sweepEvent.mockRejectedValueOnce(new Error('archived'));
    await expect(reopener.reopenEventPost(42)).rejects.toThrow('archived');
  });
});
