/**
 * Unit tests for AiSuggestionsPreGenQueueService (ROK-1316).
 *
 * Focus: the debounced `enqueue` + `removeExisting` recovery contract.
 * ROK-1316 r3 — a RETAINED `failed`/`completed` job (kept by
 * `removeOnFail: 50`) must be removed on the next enqueue so a lineup
 * never wedges; only an `active` (locked, mid-generation) job is left
 * alone. Style reference: departure-grace.queue.spec.ts.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  AiSuggestionsPreGenQueueService,
  AI_SUGGESTIONS_PREGEN_QUEUE,
} from './pre-gen.queue';

let service: AiSuggestionsPreGenQueueService;
let mockQueue: { add: jest.Mock; getJob: jest.Mock };

beforeEach(async () => {
  mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AiSuggestionsPreGenQueueService,
      {
        provide: getQueueToken(AI_SUGGESTIONS_PREGEN_QUEUE),
        useValue: mockQueue,
      },
    ],
  }).compile();
  service = module.get(AiSuggestionsPreGenQueueService);
});

afterEach(() => jest.clearAllMocks());

describe('AiSuggestionsPreGenQueueService — enqueue job creation', () => {
  it('adds a debounced job keyed `ai-suggestions-pregen-<lineupId>`', async () => {
    await service.enqueue(42, 30_000, 'mutation');
    expect(mockQueue.add).toHaveBeenCalledWith(
      'pregen',
      { lineupId: 42, reason: 'mutation' },
      expect.objectContaining({
        jobId: 'ai-suggestions-pregen-42',
        delay: 30_000,
        attempts: 3,
        removeOnComplete: true,
      }),
    );
  });

  it('records the job reason verbatim (read vs mutation)', async () => {
    await service.enqueue(7, 2_000, 'read');
    expect(mockQueue.add).toHaveBeenCalledWith(
      'pregen',
      { lineupId: 7, reason: 'read' },
      expect.objectContaining({ jobId: 'ai-suggestions-pregen-7' }),
    );
  });

  it('defaults to a mutation job (the invalidator call site)', async () => {
    await service.enqueue(9);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'pregen',
      { lineupId: 9, reason: 'mutation' },
      expect.any(Object),
    );
  });

  it('swallows queue errors so a parent mutation/read never fails', async () => {
    mockQueue.add.mockRejectedValue(new Error('Redis down'));
    await expect(service.enqueue(1, 2_000, 'read')).resolves.not.toThrow();
  });
});

describe('AiSuggestionsPreGenQueueService — removeExisting recovery (r3)', () => {
  function seedExisting(state: string): { remove: jest.Mock } {
    const job = {
      getState: jest.fn().mockResolvedValue(state),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue.getJob.mockResolvedValue(job);
    return job;
  }

  it('removes a retained FAILED job so the lineup recovers', async () => {
    const job = seedExisting('failed');
    await service.enqueue(42, 30_000, 'mutation');
    expect(job.remove).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('removes a retained COMPLETED job', async () => {
    const job = seedExisting('completed');
    await service.enqueue(42, 30_000, 'mutation');
    expect(job.remove).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('removes a delayed job (debounce reset)', async () => {
    const job = seedExisting('delayed');
    await service.enqueue(42, 30_000, 'mutation');
    expect(job.remove).toHaveBeenCalled();
  });

  it('removes a waiting job', async () => {
    const job = seedExisting('waiting');
    await service.enqueue(42, 30_000, 'mutation');
    expect(job.remove).toHaveBeenCalled();
  });

  it('does NOT disrupt an ACTIVE (mid-generation) job', async () => {
    const job = seedExisting('active');
    await service.enqueue(42, 30_000, 'mutation');
    expect(job.remove).not.toHaveBeenCalled();
    // Still attempts to add — BullMQ dedup on the locked jobId is a safe no-op.
    expect(mockQueue.add).toHaveBeenCalled();
  });
});
