/**
 * ROK-1762: clearFinishedJob removes ONLY a retained completed/failed job.
 * Real-Redis proof of the BullMQ any-state dedup lives in
 * `clear-finished-job.integration.spec.ts`.
 */
import { clearFinishedJob } from './clear-finished-job.helpers';

function makeQueue(state: string | null) {
  const job =
    state === null ? undefined : { getState: jest.fn().mockResolvedValue(state) };
  return {
    getJob: jest.fn().mockResolvedValue(job),
    remove: jest.fn().mockResolvedValue(1),
  };
}

describe('clearFinishedJob (ROK-1762)', () => {
  it.each(['completed', 'failed'])(
    'removes a retained %s job and reports its state',
    async (state) => {
      const queue = makeQueue(state);

      const seen = await clearFinishedJob(queue, 'fixed-id');

      expect(queue.getJob).toHaveBeenCalledWith('fixed-id');
      expect(queue.remove).toHaveBeenCalledWith('fixed-id');
      expect(seen).toBe(state);
    },
  );

  it.each(['waiting', 'delayed', 'prioritized', 'active', 'waiting-children'])(
    'leaves a %s job in place',
    async (state) => {
      const queue = makeQueue(state);

      const seen = await clearFinishedJob(queue, 'fixed-id');

      expect(queue.remove).not.toHaveBeenCalled();
      expect(seen).toBe(state);
    },
  );

  it('reports missing when no job holds the id', async () => {
    const queue = makeQueue(null);

    await expect(clearFinishedJob(queue, 'fixed-id')).resolves.toBe('missing');
    expect(queue.remove).not.toHaveBeenCalled();
  });
});
