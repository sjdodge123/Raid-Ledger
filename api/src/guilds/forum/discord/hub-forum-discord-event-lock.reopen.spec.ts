/**
 * ROK-2314 review MAJOR-2 / MINOR-1 — a reopened hub post re-drives the
 * website replies and signup lines it held while a reschedule poll ran (unit).
 */
import type * as links from './hub-forum-discord-links.queries';
import { HubEventPostReopenFollowups } from './hub-forum-discord-event-lock.reopen';
import type { HubForumDiscordReconcileService } from './hub-forum-discord-reconcile';
import type { HubForumDiscordSignupPingQueue } from './hub-forum-discord-signup-pings.queue';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const link = (id: number): links.ForumLink =>
  ({ id, kind: 'reply', threadId: 3 }) as links.ForumLink;

/** A db whose `update().set().where().returning()` resolves `rows`. */
function fakeDb(rows: links.ForumLink[] | Error) {
  const returning = jest.fn(() =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
  );
  const set = jest.fn(() => ({ where: () => ({ returning }) }));
  return { db: { update: () => ({ set }) }, set };
}

function setup(rows: links.ForumLink[] | Error) {
  const { db, set } = fakeDb(rows);
  const reconcile = { retryLinks: jest.fn().mockResolvedValue(0) };
  const pings = { schedule: jest.fn().mockResolvedValue(true) };
  const followups = new HubEventPostReopenFollowups(
    db as unknown as ForumDiscordDb,
    reconcile as unknown as HubForumDiscordReconcileService,
    pings as unknown as HubForumDiscordSignupPingQueue,
  );
  return { followups, reconcile, pings, set };
}

const post = (eventId: number | null) => ({
  threadId: 3,
  eventId,
  discordThreadId: '9',
});

describe('ROK-2314 HubEventPostReopenFollowups.afterReopen', () => {
  it('resets the held replies, then re-drives them in id order', async () => {
    const { followups, reconcile, set } = setup([link(12), link(5), link(8)]);
    await followups.afterReopen(post(42));
    expect(set).toHaveBeenCalledWith({ attempts: 0, lastError: null });
    expect(reconcile.retryLinks).toHaveBeenCalledTimes(1);
    expect(reconcile.retryLinks).toHaveBeenCalledWith([
      link(5),
      link(8),
      link(12),
    ]);
  });

  it('then re-arms the event signup flush', async () => {
    const { followups, reconcile, pings } = setup([link(5)]);
    await followups.afterReopen(post(42));
    expect(pings.schedule).toHaveBeenCalledWith(42);
    const retryAt = reconcile.retryLinks.mock.invocationCallOrder[0] ?? -1;
    const flushAt = pings.schedule.mock.invocationCallOrder[0] ?? -1;
    expect(retryAt).toBeLessThan(flushAt);
  });

  it('nothing held: no re-drive, the flush is still armed', async () => {
    const { followups, reconcile, pings } = setup([]);
    await followups.afterReopen(post(42));
    expect(reconcile.retryLinks).not.toHaveBeenCalled();
    expect(pings.schedule).toHaveBeenCalledWith(42);
  });

  it('a poll / lineup post (no event) arms no flush', async () => {
    const { followups, reconcile, pings } = setup([link(5)]);
    await followups.afterReopen(post(null));
    expect(reconcile.retryLinks).toHaveBeenCalledTimes(1);
    expect(pings.schedule).not.toHaveBeenCalled();
  });

  it('a failed requeue never throws and still arms the flush', async () => {
    const { followups, reconcile, pings } = setup(new Error('db down'));
    await expect(followups.afterReopen(post(42))).resolves.toBeUndefined();
    expect(reconcile.retryLinks).not.toHaveBeenCalled();
    expect(pings.schedule).toHaveBeenCalledWith(42);
  });

  it('a failing re-drive or flush never throws', async () => {
    const { followups, reconcile, pings } = setup([link(5)]);
    reconcile.retryLinks.mockRejectedValueOnce(new Error('discord 500'));
    pings.schedule.mockRejectedValueOnce(new Error('redis down'));
    await expect(followups.afterReopen(post(42))).resolves.toBeUndefined();
    expect(pings.schedule).toHaveBeenCalledTimes(1);
  });
});
