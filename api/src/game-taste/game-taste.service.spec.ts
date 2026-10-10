/**
 * ROK-1762: GameTasteService.enqueueRecompute uses the fixed jobId
 * `game-taste-recompute-<gameId>` and used to pass NO retention opts, so the
 * first finished recompute was kept forever and every later add for that
 * game was a silent no-op. A finished job must be cleared first, and
 * retention must be bounded.
 */
import { GameTasteService } from './game-taste.service';

/** ROK-1762: a mocked queue whose `game-taste-recompute-5` slot holds a job in `state`. */
function makeTasteQueue(state: string | null) {
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

function buildService(queue: ReturnType<typeof makeTasteQueue>) {
  return new GameTasteService({} as never, {} as never, queue as never);
}

describe('GameTasteService.enqueueRecompute (ROK-1762 retained finished job)', () => {
  it.each(['failed', 'completed'])(
    'removes a retained %s game-taste-recompute-5 job before adding',
    async (state) => {
      const queue = makeTasteQueue(state);

      await buildService(queue).enqueueRecompute(5);

      expect(queue.getJob).toHaveBeenCalledWith('game-taste-recompute-5');
      expect(queue.remove).toHaveBeenCalledWith('game-taste-recompute-5');
      expect(queue.add).toHaveBeenCalledWith(
        'recompute',
        { gameId: 5 },
        {
          jobId: 'game-taste-recompute-5',
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );
      expect(queue.remove.mock.invocationCallOrder[0]).toBeLessThan(
        queue.add.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );

  it.each(['waiting', 'delayed', 'active'])(
    'leaves a %s game-taste-recompute-5 job alone (same-id add still dedups)',
    async (state) => {
      const queue = makeTasteQueue(state);

      await buildService(queue).enqueueRecompute(5);

      expect(queue.remove).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );

  it('adds directly when no job holds the id', async () => {
    const queue = makeTasteQueue(null);

    await buildService(queue).enqueueRecompute(5);

    expect(queue.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
