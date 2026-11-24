/**
 * ROK-2272 S4a — the event-planning posts lifecycle listener (unit).
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { EventPlanningPostsListener } from './event-planning-posts.listener';
import type { EventPlanningPostsService } from './event-planning-posts.service';
import type { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function setup() {
  const service = {
    syncEvent: jest.fn().mockResolvedValue(undefined),
    closeForDeletedEvent: jest.fn().mockResolvedValue(undefined),
    resyncLiveEventPosts: jest.fn().mockResolvedValue(0),
  };
  const lock = { sweepEvent: jest.fn().mockResolvedValue(0) };
  const listener = new EventPlanningPostsListener(
    service as unknown as EventPlanningPostsService,
    lock as unknown as HubForumDiscordEventLockSweep,
  );
  return { listener, service, lock };
}

type Handler =
  'onUpdated' | 'onCancelled' | 'onRescheduling' | 'onRescheduleCleared';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('EventPlanningPostsListener', () => {
  it('declares the Core hub behaviour', () => {
    const { listener } = setup();
    expect(listener.hubBehaviour).toBe('event-planning.discord-posts');
    expect(listener.ownerPluginId).toBe('core');
  });

  it.each<Handler>([
    'onUpdated',
    'onCancelled',
    'onRescheduling',
    'onRescheduleCleared',
  ])('%s re-syncs the event post', async (handler) => {
    const { listener, service } = setup();
    await listener[handler]({ eventId: 42 });
    expect(service.syncEvent).toHaveBeenCalledWith(42);
    expect(service.closeForDeletedEvent).not.toHaveBeenCalled();
  });
});

describe('ROK-2314 EventPlanningPostsListener lock flip', () => {
  it.each<Handler>(['onUpdated', 'onRescheduling', 'onRescheduleCleared'])(
    'ROK-2314: %s flips that event post lock AFTER the re-sync',
    async (handler) => {
      const { listener, service, lock } = setup();
      await listener[handler]({ eventId: 42 });
      expect(lock.sweepEvent).toHaveBeenCalledWith(42);
      const syncAt = service.syncEvent.mock.invocationCallOrder[0] ?? -1;
      const lockAt = lock.sweepEvent.mock.invocationCallOrder[0] ?? -1;
      expect(syncAt).toBeLessThan(lockAt);
    },
  );

  it('ROK-2314: onCancelled and onDeleted do not flip the lock', async () => {
    const { listener, lock } = setup();
    await listener.onCancelled({ eventId: 42 });
    await listener.onDeleted({ eventId: 42 });
    expect(lock.sweepEvent).not.toHaveBeenCalled();
  });

  it('ROK-2314: a failed re-sync still flips the lock; a failed flip is captured', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.mocked(Sentry.captureException).mockClear();
    const { listener, service, lock } = setup();
    service.syncEvent.mockRejectedValueOnce(new Error('db down'));
    lock.sweepEvent.mockRejectedValueOnce(new Error('discord down'));
    await expect(
      listener.onRescheduling({ eventId: 5 }),
    ).resolves.toBeUndefined();
    expect(lock.sweepEvent).toHaveBeenCalledWith(5);
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });
});

describe('EventPlanningPostsListener (connect, delete, bad payloads)', () => {
  it('onConnected runs the reconnect resync pass (Codex P2-2)', async () => {
    const { listener, service } = setup();
    await listener.onConnected();
    expect(service.resyncLiveEventPosts).toHaveBeenCalledTimes(1);
  });

  it('onConnected never throws into the connect handler', async () => {
    const { listener, service } = setup();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service.resyncLiveEventPosts.mockRejectedValueOnce(new Error('db down'));
    await expect(listener.onConnected()).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('onDeleted closes the post without looking the event up', async () => {
    const { listener, service } = setup();
    await listener.onDeleted({ eventId: 7 });
    expect(service.closeForDeletedEvent).toHaveBeenCalledWith(7);
    expect(service.syncEvent).not.toHaveBeenCalled();
  });

  it.each([[undefined], [null], [{}], [{ eventId: 'x' }], [{ eventId: 0 }]])(
    'a bad payload %p calls nothing',
    async (payload) => {
      const { listener, service, lock } = setup();
      await listener.onUpdated(payload);
      await listener.onDeleted(payload);
      await listener.onRescheduling(payload);
      expect(service.syncEvent).not.toHaveBeenCalled();
      expect(lock.sweepEvent).not.toHaveBeenCalled();
      expect(service.closeForDeletedEvent).not.toHaveBeenCalled();
    },
  );

  it('a service rejection is swallowed, logged and captured', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { listener, service } = setup();
    service.syncEvent.mockRejectedValueOnce(new Error('boom'));
    await expect(listener.onUpdated({ eventId: 3 })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
