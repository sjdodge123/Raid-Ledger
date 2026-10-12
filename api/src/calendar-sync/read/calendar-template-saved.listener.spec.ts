/**
 * ROK-1593 D16: a template save enqueues one away-day derive for the user,
 * and a queue failure never escapes the listener.
 */
import type { Queue } from 'bullmq';
import { CalendarTemplateSavedListener } from './calendar-template-saved.listener';

function makeQueue(add = jest.fn().mockResolvedValue({})) {
  return {
    add,
    getJob: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(0),
  };
}

describe('CalendarTemplateSavedListener', () => {
  it('enqueues a derive job keyed to the user', async () => {
    const queue = makeQueue();
    const listener = new CalendarTemplateSavedListener(
      queue as unknown as Queue,
    );
    await listener.onTemplateSaved({ userId: 42 });
    expect(queue.add).toHaveBeenCalledWith(
      'derive',
      { kind: 'derive', userId: 42 },
      expect.objectContaining({ jobId: 'cal-derive-42' }),
    );
  });

  it('swallows a queue failure (the template save already committed)', async () => {
    const queue = makeQueue(jest.fn().mockRejectedValue(new Error('redis')));
    const listener = new CalendarTemplateSavedListener(
      queue as unknown as Queue,
    );
    await expect(listener.onTemplateSaved({ userId: 42 })).resolves.toBe(
      undefined,
    );
  });
});
