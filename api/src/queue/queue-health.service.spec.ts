import { QueueHealthService } from './queue-health.service';
import { Queue } from 'bullmq';

describe('QueueHealthService', () => {
  let service: QueueHealthService;

  beforeEach(() => {
    service = new QueueHealthService();
  });

  it('should return empty array when no queues registered', async () => {
    const result = await service.getHealthStatus();
    expect(result).toEqual([]);
  });

  it('should return health status for registered queues', async () => {
    const mockQueue = {
      name: 'test-queue',
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      }),
    } as unknown as Queue;

    service.register(mockQueue);

    const result = await service.getHealthStatus();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'test-queue',
      waiting: 5,
      active: 2,
      completed: 100,
      failed: 3,
      delayed: 1,
    });
  });

  it('should track multiple queues', async () => {
    const mockQueue1 = {
      name: 'queue-1',
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 1,
        active: 0,
        completed: 10,
        failed: 0,
        delayed: 0,
      }),
    } as unknown as Queue;

    const mockQueue2 = {
      name: 'queue-2',
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 1,
        completed: 50,
        failed: 2,
        delayed: 3,
      }),
    } as unknown as Queue;

    service.register(mockQueue1);
    service.register(mockQueue2);

    const result = await service.getHealthStatus();

    expect(result).toHaveLength(2);
    expect(result.map((q) => q.name)).toEqual(['queue-1', 'queue-2']);
  });
});
