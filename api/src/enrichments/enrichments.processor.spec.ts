import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueHealthService } from '../queue/queue-health.service';
import { EnrichmentsProcessor } from './enrichments.processor';
import { EnrichmentsService } from './enrichments.service';
import { ENRICHMENT_QUEUE, EnrichmentJobData } from './enrichments.constants';

function buildJob(data: unknown): Job<EnrichmentJobData> {
  return { data } as unknown as Job<EnrichmentJobData>;
}

describe('EnrichmentsProcessor', () => {
  let processor: EnrichmentsProcessor;
  let mockEnrichmentsService: {
    runCharacterEnrichment: jest.Mock;
    runEventEnrichment: jest.Mock;
  };
  let mockQueue: { name: string; add: jest.Mock };
  let mockQueueHealth: { register: jest.Mock };

  beforeEach(async () => {
    mockEnrichmentsService = {
      runCharacterEnrichment: jest.fn().mockResolvedValue(undefined),
      runEventEnrichment: jest.fn().mockResolvedValue(undefined),
    };

    mockQueue = { name: ENRICHMENT_QUEUE, add: jest.fn() };
    mockQueueHealth = { register: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrichmentsProcessor,
        { provide: EnrichmentsService, useValue: mockEnrichmentsService },
        { provide: getQueueToken(ENRICHMENT_QUEUE), useValue: mockQueue },
        { provide: QueueHealthService, useValue: mockQueueHealth },
      ],
    }).compile();

    processor = module.get<EnrichmentsProcessor>(EnrichmentsProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit()', () => {
    it('should register the enrichment queue with QueueHealthService', () => {
      processor.onModuleInit();

      expect(mockQueueHealth.register).toHaveBeenCalledWith(mockQueue);
    });
  });

  describe('process() — character jobs', () => {
    it('should dispatch character enrichment job to runCharacterEnrichment', async () => {
      const job = buildJob({
        characterId: 'char-1',
        enricherKey: 'raider-io',
        gameSlug: 'world-of-warcraft',
      });

      await processor.process(job);

      expect(mockEnrichmentsService.runCharacterEnrichment).toHaveBeenCalledWith(
        'char-1',
        'raider-io',
        'world-of-warcraft',
      );
      expect(mockEnrichmentsService.runEventEnrichment).not.toHaveBeenCalled();
    });

    it('should propagate errors thrown by runCharacterEnrichment', async () => {
      const error = new Error('Raider.IO API timed out');
      mockEnrichmentsService.runCharacterEnrichment.mockRejectedValueOnce(error);

      const job = buildJob({
        characterId: 'char-1',
        enricherKey: 'raider-io',
        gameSlug: 'world-of-warcraft',
      });

      await expect(processor.process(job)).rejects.toThrow(
        'Raider.IO API timed out',
      );
    });
  });

  describe('process() — event jobs', () => {
    it('should dispatch event enrichment job to runEventEnrichment', async () => {
      const job = buildJob({
        eventId: '42',
        enricherKey: 'event-stats',
        gameSlug: 'world-of-warcraft',
      });

      await processor.process(job);

      expect(mockEnrichmentsService.runEventEnrichment).toHaveBeenCalledWith(
        '42',
        'event-stats',
        'world-of-warcraft',
      );
      expect(
        mockEnrichmentsService.runCharacterEnrichment,
      ).not.toHaveBeenCalled();
    });

    it('should propagate errors thrown by runEventEnrichment', async () => {
      const error = new Error('WarcraftLogs API rate-limited');
      mockEnrichmentsService.runEventEnrichment.mockRejectedValueOnce(error);

      const job = buildJob({
        eventId: '99',
        enricherKey: 'warcraftlogs',
        gameSlug: 'world-of-warcraft',
      });

      await expect(processor.process(job)).rejects.toThrow(
        'WarcraftLogs API rate-limited',
      );
    });
  });

  describe('process() — unknown job data', () => {
    it('should handle job data with neither characterId nor eventId without throwing', async () => {
      // Simulates a malformed or unexpected job payload
      const job = buildJob({ enricherKey: 'raider-io', gameSlug: 'wow' });

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(
        mockEnrichmentsService.runCharacterEnrichment,
      ).not.toHaveBeenCalled();
      expect(mockEnrichmentsService.runEventEnrichment).not.toHaveBeenCalled();
    });

    it('should handle completely empty job data without throwing', async () => {
      const job = buildJob({});

      await expect(processor.process(job)).resolves.toBeUndefined();
    });
  });

  describe('process() — job type discrimination', () => {
    it('should use characterId branch when both characterId and eventId are present', async () => {
      // Edge: job data technically satisfies both discriminant checks
      const job = buildJob({
        characterId: 'char-1',
        eventId: '42',
        enricherKey: 'raider-io',
        gameSlug: 'world-of-warcraft',
      });

      await processor.process(job);

      // characterId branch is checked first in the implementation
      expect(
        mockEnrichmentsService.runCharacterEnrichment,
      ).toHaveBeenCalledWith('char-1', 'raider-io', 'world-of-warcraft');
    });
  });
});
