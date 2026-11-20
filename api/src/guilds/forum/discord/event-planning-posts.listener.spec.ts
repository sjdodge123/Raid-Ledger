/**
 * ROK-2272 S4a — the event-planning posts lifecycle listener (unit).
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { EventPlanningPostsListener } from './event-planning-posts.listener';
import type { EventPlanningPostsService } from './event-planning-posts.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function setup() {
  const service = {
    syncEvent: jest.fn().mockResolvedValue(undefined),
    closeForDeletedEvent: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new EventPlanningPostsListener(
    service as unknown as EventPlanningPostsService,
  );
  return { listener, service };
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

  it('onDeleted closes the post without looking the event up', async () => {
    const { listener, service } = setup();
    await listener.onDeleted({ eventId: 7 });
    expect(service.closeForDeletedEvent).toHaveBeenCalledWith(7);
    expect(service.syncEvent).not.toHaveBeenCalled();
  });

  it.each([[undefined], [null], [{}], [{ eventId: 'x' }], [{ eventId: 0 }]])(
    'a bad payload %p calls nothing',
    async (payload) => {
      const { listener, service } = setup();
      await listener.onUpdated(payload);
      await listener.onDeleted(payload);
      expect(service.syncEvent).not.toHaveBeenCalled();
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
