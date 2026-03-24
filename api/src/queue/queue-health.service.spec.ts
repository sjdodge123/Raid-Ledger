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

describe('QueueHealthService — configurable poll interval', () => {
  let service: QueueHealthService;

  beforeEach(() => {
    service = new QueueHealthService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.QUEUE_POLL_INTERVAL_MS;
  });

  it('should use QUEUE_POLL_INTERVAL_MS env var for poll interval', async () => {
    // Set a custom poll interval of 2000ms (instead of default 500ms)
    process.env.QUEUE_POLL_INTERVAL_MS = '2000';

    // Re-create the service so it picks up the env var
    service = new QueueHealthService();

    let pollCount = 0;
    const mockQueue = {
      name: 'test-queue',
      drain: jest.fn(),
      getJobCounts: jest.fn().mockImplementation(async () => {
        pollCount++;
        // Remain busy for the first 3 polls, then become idle
        if (pollCount <= 3) {
          return {
            waiting: 1,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
          };
        }
        return {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        };
      }),
    } as unknown as Queue;

    service.register(mockQueue);

    // Start awaitDrained in the background
    const drainPromise = service.awaitDrained(30_000);

    // After first poll (immediate), queue is busy — advance by 2000ms
    // If the service still uses 500ms, it would poll again at 500ms
    // but with our 2000ms config, it should not poll again until 2000ms
    await jest.advanceTimersByTimeAsync(500);

    // With the default 500ms interval, we'd have 2 polls by now
    // (one immediate + one after 500ms). With 2000ms interval,
    // we should still only have 1 poll (the immediate one).
    // This assertion will FAIL because the current implementation
    // hardcodes pollInterval = 500.
    expect(pollCount).toBe(1);

    // Advance to 2000ms — now the second poll should fire
    await jest.advanceTimersByTimeAsync(1500);
    expect(pollCount).toBe(2);

    // Advance another 2000ms for third poll
    await jest.advanceTimersByTimeAsync(2000);
    expect(pollCount).toBe(3);

    // Advance another 2000ms — fourth poll should find idle queues
    await jest.advanceTimersByTimeAsync(2000);

    await drainPromise;
    expect(pollCount).toBe(4);
  });

  it('should default to 500ms when QUEUE_POLL_INTERVAL_MS is not set', async () => {
    // Ensure env var is NOT set
    delete process.env.QUEUE_POLL_INTERVAL_MS;
    service = new QueueHealthService();

    let pollCount = 0;
    const mockQueue = {
      name: 'test-queue',
      drain: jest.fn(),
      getJobCounts: jest.fn().mockImplementation(async () => {
        pollCount++;
        if (pollCount <= 2) {
          return {
            waiting: 1,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
          };
        }
        return {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        };
      }),
    } as unknown as Queue;

    service.register(mockQueue);

    const drainPromise = service.awaitDrained(30_000);

    // First poll is immediate; advance 500ms for second poll
    await jest.advanceTimersByTimeAsync(500);
    expect(pollCount).toBe(2);

    // Advance another 500ms for third poll (which finds idle)
    await jest.advanceTimersByTimeAsync(500);

    await drainPromise;
    expect(pollCount).toBe(3);
  });
});
