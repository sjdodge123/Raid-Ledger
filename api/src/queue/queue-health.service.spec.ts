import { QueueHealthService } from './queue-health.service';
import { Queue } from 'bullmq';

function describeQueueHealthService() {
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
  it('should drain all queues', async () => {
    const mockQueue = {
      name: 'test-queue',
      drain: jest.fn().mockResolvedValue(undefined),
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      }),
    } as unknown as Queue;

    service.register(mockQueue);
    await service.drainAll();

    expect(mockQueue.drain).toHaveBeenCalled();
  });

  it('should drain multiple queues', async () => {
    const q1 = {
      name: 'q1',
      drain: jest.fn().mockResolvedValue(undefined),
      getJobCounts: jest.fn(),
    } as unknown as Queue;
    const q2 = {
      name: 'q2',
      drain: jest.fn().mockResolvedValue(undefined),
      getJobCounts: jest.fn(),
    } as unknown as Queue;

    service.register(q1);
    service.register(q2);
    await service.drainAll();

    expect(q1.drain).toHaveBeenCalled();
    expect(q2.drain).toHaveBeenCalled();
  });

  it('should resolve awaitDrained when queues are idle', async () => {
    const mockQueue = {
      name: 'test-queue',
      drain: jest.fn(),
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 10,
        failed: 0,
        delayed: 0,
      }),
    } as unknown as Queue;

    service.register(mockQueue);
    await expect(service.awaitDrained(5000)).resolves.not.toThrow();
  });

  it('should timeout awaitDrained when queues remain active', async () => {
    const mockQueue = {
      name: 'stuck-queue',
      drain: jest.fn(),
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 0,
        failed: 0,
        delayed: 0,
      }),
    } as unknown as Queue;

    service.register(mockQueue);
    await expect(service.awaitDrained(500)).rejects.toThrow(/timed out/i);
  });
}
describe('QueueHealthService', () => describeQueueHealthService());
