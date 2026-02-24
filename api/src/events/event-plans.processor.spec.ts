import { Test, TestingModule } from '@nestjs/testing';
import { EventPlansProcessor } from './event-plans.processor';
import { EventPlansService } from './event-plans.service';
import type { Job } from 'bullmq';
import type { PollClosedJobData } from './event-plans.service';

const PLAN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeJob(planId: string = PLAN_ID): Job<PollClosedJobData> {
  return {
    id: 'job-1',
    data: { planId },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as unknown as Job<PollClosedJobData>;
}

describe('EventPlansProcessor', () => {
  let processor: EventPlansProcessor;
  let mockService: { processPollClose: jest.Mock };

  beforeEach(async () => {
    mockService = {
      processPollClose: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventPlansProcessor,
        { provide: EventPlansService, useValue: mockService },
      ],
    }).compile();

    processor = module.get<EventPlansProcessor>(EventPlansProcessor);
  });


  describe('process', () => {
    it('should delegate to EventPlansService.processPollClose with the planId', async () => {
      const job = makeJob(PLAN_ID);

      await processor.process(job);

      expect(mockService.processPollClose).toHaveBeenCalledWith(PLAN_ID);
      expect(mockService.processPollClose).toHaveBeenCalledTimes(1);
    });

    it('should re-throw errors so BullMQ can retry', async () => {
      mockService.processPollClose.mockRejectedValue(new Error('DB failure'));

      const job = makeJob(PLAN_ID);

      await expect(processor.process(job)).rejects.toThrow('DB failure');
    });

    it('should handle different plan IDs correctly', async () => {
      const otherId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
      const job = makeJob(otherId);

      await processor.process(job);

      expect(mockService.processPollClose).toHaveBeenCalledWith(otherId);
    });

    it('should not swallow errors silently', async () => {
      const error = new Error('Discord unavailable');
      mockService.processPollClose.mockRejectedValue(error);

      const job = makeJob(PLAN_ID);

      await expect(processor.process(job)).rejects.toBe(error);
    });
  });
});
