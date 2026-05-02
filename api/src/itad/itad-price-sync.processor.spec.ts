/**
 * Unit tests for ItadPriceSyncProcessor (ROK-1047).
 * Covers job processing, error containment, and per-game dedupe by jobId.
 */
import { ItadPriceSyncProcessor } from './itad-price-sync.processor';
import {
  buildPriceSyncJobId,
  enqueuePriceSync,
} from './itad-price-sync.helpers';
import type { ItadPriceSyncService } from './itad-price-sync.service';
import type { Job, Queue } from 'bullmq';

function buildProcessor(
  service: Partial<ItadPriceSyncService>,
  queue?: Partial<Queue>,
): ItadPriceSyncProcessor {
  const queueHealth = { register: jest.fn() };
  return new ItadPriceSyncProcessor(
    service as ItadPriceSyncService,
    (queue ?? { add: jest.fn() }) as Queue,
    queueHealth as never,
  );
}

describe('ItadPriceSyncProcessor.process', () => {
  it('delegates to syncSpecificGames with the job gameId', async () => {
    const sync = jest.fn().mockResolvedValue(undefined);
    const proc = buildProcessor({ syncSpecificGames: sync });

    await proc.process({ data: { gameId: 42 } } as Job);

    expect(sync).toHaveBeenCalledWith([42]);
  });

  it('swallows ITAD errors so a single failure does not poison the queue', async () => {
    const sync = jest.fn().mockRejectedValue(new Error('ITAD 502'));
    const proc = buildProcessor({ syncSpecificGames: sync });

    await expect(
      proc.process({ data: { gameId: 7 } } as Job),
    ).resolves.toBeUndefined();
    expect(sync).toHaveBeenCalledWith([7]);
  });
});

describe('enqueuePriceSync', () => {
  it('uses jobId itad-price-<gameId> for per-game dedupe', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Queue;

    await enqueuePriceSync(queue, 99);

    expect(add).toHaveBeenCalledWith(
      'sync',
      { gameId: 99 },
      expect.objectContaining({
        jobId: 'itad-price-99',
        removeOnComplete: 100,
      }),
    );
  });

  it('buildPriceSyncJobId is stable per gameId', () => {
    expect(buildPriceSyncJobId(1)).toBe('itad-price-1');
    expect(buildPriceSyncJobId(1234)).toBe('itad-price-1234');
  });
});

describe('ItadPriceSyncProcessor.onModuleInit', () => {
  it('registers the queue with QueueHealthService', () => {
    const sync = jest.fn();
    const queue = { add: jest.fn() };
    const queueHealth = { register: jest.fn() };
    const proc = new ItadPriceSyncProcessor(
      { syncSpecificGames: sync } as never,
      queue as unknown as Queue,
      queueHealth as never,
    );

    proc.onModuleInit();

    expect(queueHealth.register).toHaveBeenCalledWith(queue);
  });
});
