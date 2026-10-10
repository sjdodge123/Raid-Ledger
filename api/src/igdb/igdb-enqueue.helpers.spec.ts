/**
 * ROK-1741: enqueueSyncJob uses a fixed jobId (`igdb-scheduled-sync`) with
 * `removeOnComplete: 100, removeOnFail: 50`. BullMQ ignores an `add` whose
 * jobId already exists in ANY state, so a retained completed/failed job
 * silently wedged every later 6-hourly sync. A retained job must be cleared
 * first; an `active` one must not be doubled.
 */
import { enqueueSyncJob } from './igdb-enqueue.helpers';

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
