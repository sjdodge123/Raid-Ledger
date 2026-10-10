/**
 * ROK-1762: BullMQ ignores an `add` whose jobId already exists in ANY state,
 * `completed` and `failed` included. Both events-side fixed-jobId enqueues
 * retain failed jobs (`removeOnFail: 50`), so one exhausted job used to wedge
 * every later enqueue for the same entity:
 *   - bench promotion `promote-<event>-<role>-<pos>`: that slot never
 *     auto-promotes a bench player again;
 *   - plan poll close `plan-poll-close-<plan>`: a restarted / re-rounded poll
 *     never closes and the plan stays in `polling`.
 * A retained finished job must be removed BEFORE the add. A pending
 * (delayed/waiting) job is left alone, so its delay timer is not reset.
 */
import type { Queue } from 'bullmq';
import {
  BenchPromotionService,
  PROMOTION_DELAY_MS,
} from './bench-promotion.service';
import { EventPlansService } from './event-plans.service';

/** A queue whose single slot holds a job in `state` (or nothing). */
function makeQueue(state: string | null) {
  const existing =
    state === null
      ? undefined
      : { getState: jest.fn().mockResolvedValue(state) };
  return {
    getJob: jest.fn().mockResolvedValue(existing),
    remove: jest.fn().mockResolvedValue(1),
    add: jest.fn().mockResolvedValue(undefined),
  };
}

type FakeQueue = ReturnType<typeof makeQueue>;

/** True when `remove` ran strictly before `add`. */
function removedBeforeAdd(queue: FakeQueue): boolean {
  const removeAt = queue.remove.mock.invocationCallOrder[0] ?? Infinity;
  const addAt = queue.add.mock.invocationCallOrder[0] ?? -Infinity;
  return removeAt < addAt;
}

function benchService(queue: FakeQueue): BenchPromotionService {
  return new BenchPromotionService(queue as unknown as Queue, {} as never);
}

function schedulePollClose(queue: FakeQueue, planId: string, ms: number) {
  const service = new EventPlansService(
    {} as never,
    queue as unknown as Queue,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return service['schedulePollClose'](planId, ms);
}

describe('BenchPromotionService.schedulePromotion (ROK-1762 retained jobId)', () => {
  const JOB_ID = 'promote-9-player-2';

  it.each(['completed', 'failed'])(
    'removes a retained %s promote job before re-adding it',
    async (state) => {
      const queue = makeQueue(state);

      await benchService(queue).schedulePromotion(9, 'player', 2);

      expect(queue.remove).toHaveBeenCalledWith(JOB_ID);
      expect(removedBeforeAdd(queue)).toBe(true);
      expect(queue.add).toHaveBeenCalledWith(
        'promote',
        { eventId: 9, vacatedRole: 'player', vacatedPosition: 2 },
        expect.objectContaining({ jobId: JOB_ID, delay: PROMOTION_DELAY_MS }),
      );
    },
  );

  it.each(['delayed', 'waiting', 'active'])(
    'leaves a %s promote job alone (plain dedup, delay timer not reset)',
    async (state) => {
      const queue = makeQueue(state);

      await benchService(queue).schedulePromotion(9, 'player', 2);

      expect(queue.remove).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );

  it('adds directly when no job holds the id', async () => {
    const queue = makeQueue(null);

    await benchService(queue).schedulePromotion(9, 'player', 2);

    expect(queue.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});

describe('EventPlansService.schedulePollClose (ROK-1762 retained jobId)', () => {
  const PLAN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const JOB_ID = `plan-poll-close-${PLAN_ID}`;

  it.each(['completed', 'failed'])(
    'removes a retained %s poll-close job before re-adding it',
    async (state) => {
      const queue = makeQueue(state);

      await schedulePollClose(queue, PLAN_ID, 3_600_000);

      expect(queue.remove).toHaveBeenCalledWith(JOB_ID);
      expect(removedBeforeAdd(queue)).toBe(true);
      expect(queue.add).toHaveBeenCalledWith(
        'poll-closed',
        { planId: PLAN_ID },
        expect.objectContaining({ jobId: JOB_ID, delay: 3_600_000 }),
      );
    },
  );

  it.each(['delayed', 'waiting', 'active'])(
    'leaves a %s poll-close job alone (plain dedup, unchanged)',
    async (state) => {
      const queue = makeQueue(state);

      await schedulePollClose(queue, PLAN_ID, 3_600_000);

      expect(queue.remove).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );
});
