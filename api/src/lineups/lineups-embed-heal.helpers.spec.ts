/**
 * ROK-1370 / ROK-1857 — the `onEventsCleared` callback heals the embed AND
 * emits RESCHEDULE_CLEARED per cleared event so calendar copies are restored.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import type { EmbedSyncQueueService } from '../discord-bot/queues/embed-sync.queue';
import { healClearedEventEmbeds } from './lineups-embed-heal.helpers';

function makeQueue() {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  return { enqueue, queue: { enqueue } as unknown as EmbedSyncQueueService };
}

function makeEmitter() {
  const emit = jest.fn().mockReturnValue(true);
  return { emit, emitter: { emit } as unknown as EventEmitter2 };
}

const logger = new Logger('test');

describe('healClearedEventEmbeds', () => {
  it('emits RESCHEDULE_CLEARED once per cleared event, with { eventId }', () => {
    const { queue, enqueue } = makeQueue();
    const { emitter, emit } = makeEmitter();
    healClearedEventEmbeds(queue, logger, emitter)([11, 12]);
    expect(emit.mock.calls).toEqual([
      [APP_EVENT_EVENTS.RESCHEDULE_CLEARED, { eventId: 11 }],
      [APP_EVENT_EVENTS.RESCHEDULE_CLEARED, { eventId: 12 }],
    ]);
    expect(enqueue.mock.calls).toEqual([
      [11, 'reschedule-poll-cleared'],
      [12, 'reschedule-poll-cleared'],
    ]);
  });

  it('still emits when the embed queue is absent', () => {
    const { emitter, emit } = makeEmitter();
    healClearedEventEmbeds(undefined, logger, emitter)([5]);
    expect(emit).toHaveBeenCalledWith(APP_EVENT_EVENTS.RESCHEDULE_CLEARED, {
      eventId: 5,
    });
  });

  it('no emitter → embed heal only, no throw', () => {
    const { queue, enqueue } = makeQueue();
    expect(() => healClearedEventEmbeds(queue, logger)([5])).not.toThrow();
    expect(enqueue).toHaveBeenCalledWith(5, 'reschedule-poll-cleared');
  });

  it('no cleared events → nothing emitted', () => {
    const { emitter, emit } = makeEmitter();
    healClearedEventEmbeds(undefined, logger, emitter)([]);
    expect(emit).not.toHaveBeenCalled();
  });
});
