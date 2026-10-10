/**
 * ROK-1741: enqueueSyncJob uses a fixed jobId (`igdb-scheduled-sync`) with
 * `removeOnComplete: 100, removeOnFail: 50`. BullMQ ignores an `add` whose
 * jobId already exists in ANY state, so a retained completed/failed job
 * silently wedged every later 6-hourly sync. A retained job must be cleared
 * first; an `active` one must not be doubled.
 */
import { enqueueReenrichJob, enqueueSyncJob } from './igdb-enqueue.helpers';
import { REENRICH_DELAY_MS } from './igdb-sync.constants';

function makeQueue(existingState: string | null) {
  const existing =
    existingState === null
      ? undefined
      : {
          getState: jest.fn().mockResolvedValue(existingState),
          remove: jest.fn().mockResolvedValue(undefined),
        };
  const queue = {
    getJob: jest.fn().mockResolvedValue(existing),
    add: jest.fn().mockResolvedValue({ id: 'igdb-scheduled-sync' }),
  };
  return { queue, existing };
}

describe('enqueueSyncJob (ROK-1741 retained-jobId wedge)', () => {
  it.each(['failed', 'completed'])(
    'removes a retained %s job before adding the next sync',
    async (state) => {
      const { queue, existing } = makeQueue(state);

      const result = await enqueueSyncJob(queue, 'scheduled');

      expect(queue.getJob).toHaveBeenCalledWith('igdb-scheduled-sync');
      expect(existing?.remove).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'sync',
        { trigger: 'scheduled' },
        expect.objectContaining({ jobId: 'igdb-scheduled-sync' }),
      );
      expect(result).toEqual({ jobId: 'igdb-scheduled-sync' });
    },
  );

  it('adds directly when no job exists for the jobId', async () => {
    const { queue } = makeQueue(null);

    await enqueueSyncJob(queue, 'manual');

    expect(queue.add).toHaveBeenCalledWith(
      'sync',
      { trigger: 'manual' },
      expect.objectContaining({ jobId: 'igdb-manual-sync' }),
    );
  });

  it('does not remove or re-add while a sync is active', async () => {
    const { queue, existing } = makeQueue('active');

    const result = await enqueueSyncJob(queue, 'scheduled');

    expect(existing?.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(result).toEqual({ jobId: 'igdb-scheduled-sync' });
  });
});

/** ROK-1762: a mocked queue whose `reenrich-42` slot holds a job in `state`. */
function makeReenrichQueue(state: string | null) {
  const job =
    state === null
      ? undefined
      : { getState: jest.fn().mockResolvedValue(state) };
  return {
    getJob: jest.fn().mockResolvedValue(job),
    remove: jest.fn().mockResolvedValue(1),
    add: jest.fn().mockResolvedValue({ id: 'job' }),
  };
}

describe('enqueueReenrichJob (ROK-1762 retained finished job)', () => {
  it.each(['failed', 'completed'])(
    'removes a retained %s reenrich-42 job before adding',
    async (state) => {
      const queue = makeReenrichQueue(state);

      await enqueueReenrichJob(queue, 42);

      expect(queue.getJob).toHaveBeenCalledWith('reenrich-42');
      expect(queue.remove).toHaveBeenCalledWith('reenrich-42');
      expect(queue.add).toHaveBeenCalledWith(
        'sync',
        { trigger: 'reenrich-game', gameId: 42 },
        expect.objectContaining({
          jobId: 'reenrich-42',
          delay: REENRICH_DELAY_MS,
          removeOnComplete: 100,
          removeOnFail: 50,
        }),
      );
      expect(queue.remove.mock.invocationCallOrder[0]).toBeLessThan(
        queue.add.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );

  it.each(['waiting', 'delayed', 'active'])(
    'leaves a %s reenrich-42 job alone (same-id add still dedups)',
    async (state) => {
      const queue = makeReenrichQueue(state);

      await enqueueReenrichJob(queue, 42);

      expect(queue.remove).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );

  it('adds directly when no job holds the id', async () => {
    const queue = makeReenrichQueue(null);

    await enqueueReenrichJob(queue, 42);

    expect(queue.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
