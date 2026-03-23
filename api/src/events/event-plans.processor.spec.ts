import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EventPlansProcessor } from './event-plans.processor';
import { EventPlansService, EVENT_PLANS_QUEUE } from './event-plans.service';
import { QueueHealthService } from '../queue/queue-health.service';
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

let processor: EventPlansProcessor;
let mockService: { processPollClose: jest.Mock };

async function setupEach() {
  mockService = {
    processPollClose: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventPlansProcessor,
      { provide: EventPlansService, useValue: mockService },
      {
        provide: getQueueToken(EVENT_PLANS_QUEUE),
        useValue: {
          drain: jest.fn(),
          getJobCounts: jest.fn().mockResolvedValue({
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
          }),
        },
      },
      { provide: QueueHealthService, useValue: { register: jest.fn() } },
    ],
  }).compile();

  processor = module.get<EventPlansProcessor>(EventPlansProcessor);
}

async function testDelegatesToService() {
  const job = makeJob(PLAN_ID);
  await processor.process(job);
  expect(mockService.processPollClose).toHaveBeenCalledWith(PLAN_ID);
  expect(mockService.processPollClose).toHaveBeenCalledTimes(1);
}

async function testReThrowsErrors() {
  mockService.processPollClose.mockRejectedValue(new Error('DB failure'));
  const job = makeJob(PLAN_ID);
  await expect(processor.process(job)).rejects.toThrow('DB failure');
}

async function testDifferentPlanIds() {
  const otherId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
  const job = makeJob(otherId);
  await processor.process(job);
  expect(mockService.processPollClose).toHaveBeenCalledWith(otherId);
}

async function testDoesNotSwallowErrors() {
  const error = new Error('Discord unavailable');
  mockService.processPollClose.mockRejectedValue(error);
  const job = makeJob(PLAN_ID);
  await expect(processor.process(job)).rejects.toBe(error);
}

describe('EventPlansProcessor', () => {
  beforeEach(() => setupEach());

  describe('process', () => {
    it('should delegate to EventPlansService.processPollClose with the planId', () =>
      testDelegatesToService());
    it('should re-throw errors so BullMQ can retry', () =>
      testReThrowsErrors());
    it('should handle different plan IDs correctly', () =>
      testDifferentPlanIds());
    it('should not swallow errors silently', () => testDoesNotSwallowErrors());
  });
});
