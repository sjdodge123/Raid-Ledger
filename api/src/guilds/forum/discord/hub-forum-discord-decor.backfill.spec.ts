/**
 * ROK-2258 ruling 4 — the one-time forum-dressing backfill runs behind a
 * Redis `SET NX` guard: the winner dresses every bound forum, a loser does
 * nothing, and only a transient failure gives the guard back so the next
 * connect retries. A permanent skip (no Manage Channels, a deleted channel)
 * settles. The guard carries a TTL while it runs (a crash frees it).
 */
import type Redis from 'ioredis';
import type { DecorOutcome } from './hub-forum-discord-decor';
import type { HubForumDiscordDecor } from './hub-forum-discord-decor.apply';
import {
  FORUM_DECOR_BACKFILL_KEY,
  HubForumDiscordDecorBackfill,
} from './hub-forum-discord-decor.backfill';
import * as decorQueries from './hub-forum-discord-decor.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./hub-forum-discord-decor.queries');
const q = jest.mocked(decorQueries);

function backfill(setReply: 'OK' | null) {
  const redis = {
    set: jest.fn(() => Promise.resolve(setReply)),
    del: jest.fn(() => Promise.resolve(1)),
  };
  const decor = {
    run: jest.fn<Promise<DecorOutcome>, [number, string]>(() =>
      Promise.resolve('done'),
    ),
  };
  q.listBoundForums.mockResolvedValue([
    { id: 1, channelId: 'c1' },
    { id: 2, channelId: 'c2' },
  ]);
  const svc = new HubForumDiscordDecorBackfill(
    {} as ForumDiscordDb,
    redis as unknown as Redis,
    decor as unknown as HubForumDiscordDecor,
  );
  return { svc, redis, decor };
}

beforeEach(() => jest.resetAllMocks());

describe('ROK-2258 forum decor backfill guard', () => {
  it('acquires the guard with NX and dresses every bound forum once', async () => {
    const t = backfill('OK');
    expect(await t.svc.run(new Date('2026-11-18T00:00:00Z'))).toBe(2);
    expect(t.redis.set.mock.calls).toEqual([
      [FORUM_DECOR_BACKFILL_KEY, '2026-11-18T00:00:00.000Z', 'EX', 3600, 'NX'],
      [FORUM_DECOR_BACKFILL_KEY, '2026-11-18T00:00:00.000Z'],
    ]);
    expect(t.decor.run.mock.calls).toEqual([
      [1, 'c1'],
      [2, 'c2'],
    ]);
    expect(t.redis.del).not.toHaveBeenCalled();
  });

  it('skips everything when the guard is already held', async () => {
    const t = backfill(null);
    expect(await t.svc.run(new Date())).toBe(0);
    expect(q.listBoundForums).not.toHaveBeenCalled();
    expect(t.decor.run).not.toHaveBeenCalled();
    expect(t.redis.del).not.toHaveBeenCalled();
  });

  it('settles (keeps the guard, no TTL) when a forum is skipped for good', async () => {
    const t = backfill('OK');
    t.decor.run.mockResolvedValueOnce('settled');
    expect(await t.svc.run(new Date())).toBe(1);
    expect(t.decor.run).toHaveBeenCalledTimes(2);
    expect(t.redis.del).not.toHaveBeenCalled();
    expect(t.redis.set).toHaveBeenCalledTimes(2);
  });

  it('releases the guard on a transient failure, after trying them all', async () => {
    const t = backfill('OK');
    t.decor.run.mockResolvedValueOnce('retry');
    expect(await t.svc.run(new Date())).toBe(0);
    expect(t.decor.run).toHaveBeenCalledTimes(2);
    expect(t.redis.del).toHaveBeenCalledWith(FORUM_DECOR_BACKFILL_KEY);
  });

  it('releases the guard when listing the forums fails', async () => {
    const t = backfill('OK');
    q.listBoundForums.mockRejectedValueOnce(new Error('connection terminated'));
    expect(await t.svc.run(new Date())).toBe(0);
    expect(t.redis.del).toHaveBeenCalledWith(FORUM_DECOR_BACKFILL_KEY);
  });

  it('never throws when releasing the guard fails', async () => {
    const t = backfill('OK');
    t.decor.run.mockResolvedValue('retry');
    t.redis.del.mockRejectedValueOnce(new Error('redis down'));
    await expect(t.svc.run(new Date())).resolves.toBe(0);
  });
});
