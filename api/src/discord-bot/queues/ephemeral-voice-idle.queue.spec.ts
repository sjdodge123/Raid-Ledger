import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  EphemeralVoiceIdleQueueService,
  EPHEMERAL_VOICE_IDLE_QUEUE,
} from './ephemeral-voice-idle.queue';

let service: EphemeralVoiceIdleQueueService;
let mockQueue: { add: jest.Mock; getJob: jest.Mock };

beforeEach(async () => {
  mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EphemeralVoiceIdleQueueService,
      {
        provide: getQueueToken(EPHEMERAL_VOICE_IDLE_QUEUE),
        useValue: mockQueue,
      },
    ],
  }).compile();
  service = module.get(EphemeralVoiceIdleQueueService);
});

afterEach(() => jest.clearAllMocks());

describe('EphemeralVoiceIdleQueueService.enqueue (ROK-1352)', () => {
  it('adds a delayed job keyed by event id', async () => {
    await service.enqueue({ eventId: 7, channelId: 'ch-7' }, 30 * 60_000);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'ephemeral-idle-expire',
      { eventId: 7, channelId: 'ch-7' },
      expect.objectContaining({
        jobId: 'ephemeral-idle-7',
        delay: 30 * 60_000,
      }),
    );
  });

  it('replaces an existing pending job before adding', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    mockQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('delayed'),
      remove,
    });
    await service.enqueue({ eventId: 7, channelId: 'ch-7' }, 1000);
    expect(remove).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalled();
  });
});

describe('EphemeralVoiceIdleQueueService.cancel (ROK-1352)', () => {
  it('removes a pending job for the event', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    mockQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('waiting'),
      remove,
    });
    await service.cancel(7);
    expect(mockQueue.getJob).toHaveBeenCalledWith('ephemeral-idle-7');
    expect(remove).toHaveBeenCalled();
  });

  it('is a no-op when no job exists', async () => {
    mockQueue.getJob.mockResolvedValue(null);
    await expect(service.cancel(7)).resolves.toBeUndefined();
  });
});
