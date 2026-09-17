/**
 * ROK-1549 S1-AC1/AC2 — the scheduling-poll embed sync queue coalesces a
 * burst of votes into one Discord edit, never loses a vote that lands while a
 * job is already running, and never throws an enqueue failure into the vote.
 */
import * as Sentry from '@sentry/node';
import {
  SchedulingPollEmbedQueueService,
  SCHEDULING_POLL_EMBED_QUEUE,
  schedulingPollEmbedJobId,
} from './scheduling-poll-embed.queue';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

type FakeJob = {
  getState: jest.Mock;
  changeDelay: jest.Mock;
  remove: jest.Mock;
};

/** A BullMQ job stub in the given state. */
function fakeJob(state: string): FakeJob {
  return {
    getState: jest.fn().mockResolvedValue(state),
    changeDelay: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SchedulingPollEmbedQueueService (ROK-1549)', () => {
  let queue: { getJob: jest.Mock; add: jest.Mock };
  let service: SchedulingPollEmbedQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
    };
    service = new SchedulingPollEmbedQueueService(queue as never);
  });

  /** Jobs keyed by id; unknown ids resolve to no job. */
  function withJobs(jobs: Record<string, FakeJob>): void {
    queue.getJob.mockImplementation((id: string) => Promise.resolve(jobs[id]));
  }

  it('names the queue scheduling-poll-embed-sync', () => {
    expect(SCHEDULING_POLL_EMBED_QUEUE).toBe('scheduling-poll-embed-sync');
  });

  it('adds one delayed job with the retry options when none exists', async () => {
    await service.enqueue(7);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'sync-poll-embed',
      { matchId: 7 },
      expect.objectContaining({
        jobId: 'sched-poll-embed-7',
        delay: 2000,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 50,
      }),
    );
  });

  it('resets the delay of a delayed job instead of adding another', async () => {
    const job = fakeJob('delayed');
    withJobs({ 'sched-poll-embed-7': job });
    await service.enqueue(7);
    expect(job.changeDelay).toHaveBeenCalledWith(2000);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each(['active', 'waiting'])(
    'adds a trailing job while the primary is %s',
    async (state) => {
      withJobs({ 'sched-poll-embed-7': fakeJob(state) });
      await service.enqueue(7);
      expect(queue.add).toHaveBeenCalledWith(
        'sync-poll-embed',
        { matchId: 7 },
        expect.objectContaining({ jobId: 'sched-poll-embed-7-trail' }),
      );
    },
  );

  it('coalesces into a delayed trailing job', async () => {
    const trail = fakeJob('delayed');
    withJobs({
      'sched-poll-embed-7': fakeJob('active'),
      'sched-poll-embed-7-trail': trail,
    });
    await service.enqueue(7);
    expect(trail.changeDelay).toHaveBeenCalledWith(2000);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('replaces a retained failed job so the new sync is not silently dropped', async () => {
    const failed = fakeJob('failed');
    withJobs({ 'sched-poll-embed-7': failed });
    await service.enqueue(7);
    expect(failed.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'sync-poll-embed',
      { matchId: 7 },
      expect.objectContaining({ jobId: 'sched-poll-embed-7' }),
    );
  });

  it('never throws on an enqueue failure and reports it to Sentry', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.enqueue(7)).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { context: 'scheduling-poll-embed-enqueue' },
        extra: { matchId: 7 },
      }),
    );
  });

  it('never uses ":" in a job id (BullMQ rejects it, ROK-1512)', () => {
    expect(schedulingPollEmbedJobId(7)).not.toContain(':');
    expect(schedulingPollEmbedJobId(7, true)).not.toContain(':');
  });
});
