/**
 * ROK-1549 S1-AC2 — the processor rethrows so BullMQ retries, breadcrumbs
 * every failed attempt, and reports only the final one to Sentry.
 */
import * as Sentry from '@sentry/node';
import { DiscordAPIError } from 'discord.js';
import { UnrecoverableError } from 'bullmq';
import { SchedulingPollEmbedProcessor } from './scheduling-poll-embed.processor';

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

/** A job stub for match 7. */
function job(attemptsMade = 0, attempts = 5) {
  return { data: { matchId: 7 }, attemptsMade, opts: { attempts } } as never;
}

describe('SchedulingPollEmbedProcessor (ROK-1549)', () => {
  let syncEmbed: jest.Mock;
  let register: jest.Mock;
  let processor: SchedulingPollEmbedProcessor;
  const queue = { name: 'scheduling-poll-embed-sync' };

  beforeEach(() => {
    jest.clearAllMocks();
    syncEmbed = jest.fn().mockResolvedValue(undefined);
    register = jest.fn();
    processor = new SchedulingPollEmbedProcessor(
      queue as never,
      { syncEmbed } as never,
      { register } as never,
    );
  });

  it('registers its queue with QueueHealthService so awaitProcessing drains it', () => {
    processor.onModuleInit();
    expect(register).toHaveBeenCalledWith(queue);
  });

  it('re-renders the poll for the job match', async () => {
    await processor.process(job());
    expect(syncEmbed).toHaveBeenCalledWith(7);
  });

  it('rethrows a render failure so BullMQ retries', async () => {
    syncEmbed.mockRejectedValueOnce(new Error('discord 500'));
    await expect(processor.process(job())).rejects.toThrow('discord 500');
  });

  it('treats a deleted card (10008) as terminal — no retry', async () => {
    const gone = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
    Object.assign(gone, { code: 10008, message: 'Unknown Message' });
    syncEmbed.mockRejectedValueOnce(gone);
    await expect(processor.process(job())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('breadcrumbs a non-final failed attempt without capturing', () => {
    processor.onFailed(job(2, 5), new Error('boom'));
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'scheduling-poll-embed',
        data: { matchId: 7, attempt: 2 },
      }),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures the final failed attempt', () => {
    const err = new Error('boom');
    processor.onFailed(job(5, 5), err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { context: 'scheduling-poll-embed' },
      extra: { matchId: 7 },
    });
  });

  it('does not capture a terminal deleted-card failure', () => {
    processor.onFailed(job(1, 5), new UnrecoverableError('gone'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
