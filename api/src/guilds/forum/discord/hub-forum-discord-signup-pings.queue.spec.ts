import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { SIGNUP_PING_DEBOUNCE_MS } from './hub-forum-discord-signup-pings';
import { HubForumDiscordSignupPingCatchUp } from './hub-forum-discord-signup-pings.catch-up';
import { HubForumDiscordSignupPingListener } from './hub-forum-discord-signup-pings.listener';
import { HubForumDiscordSignupPingQueue } from './hub-forum-discord-signup-pings.queue';
import * as q from './hub-forum-discord-signup-pings.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./hub-forum-discord-signup-pings.queries');

type Fake = { state: string; changeDelay: jest.Mock; remove: jest.Mock };

function fakeQueue(jobs: Record<string, string> = {}) {
  const held = new Map<string, Fake>();
  for (const [id, state] of Object.entries(jobs)) {
    held.set(id, {
      state,
      changeDelay: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve()),
    });
  }
  const queue = {
    getJob: jest.fn((id: string) => {
      const job = held.get(id);
      return Promise.resolve(
        job
          ? { ...job, getState: () => Promise.resolve(job.state) }
          : undefined,
      );
    }),
    add: jest.fn(() => Promise.resolve()),
  };
  const svc = new HubForumDiscordSignupPingQueue(queue as unknown as Queue);
  return { svc, queue, held };
}

describe('ROK-2260 signup-ping debounce', () => {
  it('arms ONE delayed flush per event, keyed by event', async () => {
    const t = fakeQueue();
    await t.svc.schedule(42);
    expect(t.queue.add).toHaveBeenCalledWith(
      'flush-signup-pings',
      { eventId: 42 },
      expect.objectContaining({
        jobId: 'forum-signup-pings-42',
        delay: SIGNUP_PING_DEBOUNCE_MS,
      }),
    );
  });

  it('a later change resets the pending timer instead of adding a job', async () => {
    const t = fakeQueue({ 'forum-signup-pings-42': 'delayed' });
    await t.svc.schedule(42);
    expect(
      t.held.get('forum-signup-pings-42')?.changeDelay,
    ).toHaveBeenCalledWith(SIGNUP_PING_DEBOUNCE_MS);
    expect(t.queue.add).not.toHaveBeenCalled();
  });

  it('m1: a delayed job promoted mid-reset (changeDelay refused) gets a trailing flush', async () => {
    const t = fakeQueue({ 'forum-signup-pings-42': 'delayed' });
    t.held
      .get('forum-signup-pings-42')
      ?.changeDelay.mockRejectedValueOnce(
        new Error('Job is not in the delayed state'),
      );
    await t.svc.schedule(42);
    expect(t.queue.add).toHaveBeenCalledWith(
      'flush-signup-pings',
      { eventId: 42 },
      expect.objectContaining({ jobId: 'forum-signup-pings-42-trail' }),
    );
  });

  it('a change during a running flush arms a trailing flush', async () => {
    const t = fakeQueue({ 'forum-signup-pings-42': 'active' });
    await t.svc.schedule(42);
    expect(t.queue.add).toHaveBeenCalledWith(
      'flush-signup-pings',
      { eventId: 42 },
      expect.objectContaining({ jobId: 'forum-signup-pings-42-trail' }),
    );
  });

  it('clears a retained finished job so the next change still arms a flush', async () => {
    const t = fakeQueue({ 'forum-signup-pings-42': 'completed' });
    await t.svc.schedule(42);
    expect(t.held.get('forum-signup-pings-42')?.remove).toHaveBeenCalled();
    expect(t.queue.add).toHaveBeenCalledTimes(1);
  });

  it('never throws into the signup path when Redis is down', async () => {
    const t = fakeQueue();
    t.queue.getJob.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(t.svc.schedule(42)).resolves.toBeUndefined();
  });
});

describe('ROK-2260 signup-ping listener', () => {
  it('re-arms the event on create, update and delete; ignores a payload with no event', async () => {
    const queue = { schedule: jest.fn(() => Promise.resolve()) };
    const l = new HubForumDiscordSignupPingListener(
      queue as unknown as HubForumDiscordSignupPingQueue,
    );
    await l.onCreated({ eventId: 1, action: 'signup_created' });
    await l.onUpdated({ eventId: 2, action: 'signup_cancelled' });
    await l.onDeleted({ eventId: 3, action: 'deleted' });
    expect(queue.schedule.mock.calls).toEqual([[1], [2], [3]]);
  });
});

describe('ROK-2260 one-time deploy catch-up', () => {
  function catchUp(setReply: 'OK' | null) {
    const redis = {
      set: jest.fn(() => Promise.resolve(setReply)),
      del: jest.fn(() => Promise.resolve(1)),
    };
    const queue = { schedule: jest.fn(() => Promise.resolve()) };
    jest.mocked(q.listUpcomingBoundEventIds).mockResolvedValue([5, 6]);
    const svc = new HubForumDiscordSignupPingCatchUp(
      {} as ForumDiscordDb,
      redis as unknown as Redis,
      queue as unknown as HubForumDiscordSignupPingQueue,
    );
    return { svc, redis, queue };
  }

  it('arms every upcoming bound event once, when it wins the guard', async () => {
    const t = catchUp('OK');
    expect(await t.svc.run(new Date())).toBe(2);
    expect(t.redis.set).toHaveBeenCalledWith(
      'hub-forum:signup-pings:catch-up:v1',
      expect.any(String),
      'NX',
    );
    expect(t.queue.schedule.mock.calls).toEqual([[5], [6]]);
  });

  it('does nothing on every later boot (guard already set)', async () => {
    const t = catchUp(null);
    expect(await t.svc.run(new Date())).toBe(0);
    expect(t.queue.schedule).not.toHaveBeenCalled();
  });

  it('m5: a failed catch-up releases the guard so the next boot retries it', async () => {
    const t = catchUp('OK');
    jest
      .mocked(q.listUpcomingBoundEventIds)
      .mockRejectedValueOnce(new Error('connection terminated'));
    expect(await t.svc.run(new Date())).toBe(0);
    expect(t.redis.del).toHaveBeenCalledWith(
      'hub-forum:signup-pings:catch-up:v1',
    );
  });

  it('m5: a boot that lost the guard never releases it', async () => {
    const t = catchUp(null);
    await t.svc.run(new Date());
    expect(t.redis.del).not.toHaveBeenCalled();
  });
});
