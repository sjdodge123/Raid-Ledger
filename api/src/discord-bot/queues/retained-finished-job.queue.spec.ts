/**
 * ROK-1762: every discord-bot producer that enqueues under a FIXED jobId must
 * not be silently blocked by a retained completed/failed job with that id.
 *
 * The fake queue models the BullMQ behaviour the bug depends on: an `add`
 * whose jobId already exists in ANY state is ignored. A plain `jest.fn()` add
 * cannot catch this bug, because it records the call either way.
 */
import type { Queue } from 'bullmq';
import { EmbedSyncQueueService } from './embed-sync.queue';
import { DepartureGraceQueueService } from './departure-grace.queue';
import { AdHocGracePeriodQueueService } from './ad-hoc-grace-period.queue';
import { EphemeralVoiceIdleQueueService } from './ephemeral-voice-idle.queue';

type FakeState = 'completed' | 'failed' | 'delayed' | 'waiting' | 'active';

function makeFakeQueue(jobId: string, state: FakeState) {
  const store = new Map<string, FakeState>([[jobId, state]]);
  const accepted: Array<{ name: string; jobId: string }> = [];
  const changeDelay = jest.fn(() => Promise.resolve());
  const jobFor = (id: string) => ({
    getState: jest.fn(() => Promise.resolve(store.get(id))),
    remove: jest.fn(() => Promise.resolve(void store.delete(id))),
    updateData: jest.fn(() => Promise.resolve()),
    changeDelay,
  });
  const queue = {
    getJob: jest.fn((id: string) =>
      Promise.resolve(store.has(id) ? jobFor(id) : undefined),
    ),
    remove: jest.fn((id: string) => Promise.resolve(store.delete(id) ? 1 : 0)),
    add: jest.fn((name: string, _data: unknown, opts: { jobId: string }) => {
      if (store.has(opts.jobId)) return Promise.resolve(undefined);
      store.set(opts.jobId, 'delayed');
      accepted.push({ name, jobId: opts.jobId });
      return Promise.resolve({ id: opts.jobId });
    }),
  };
  return { queue, accepted, store, changeDelay };
}

interface Site {
  jobId: string;
  enqueue: (queue: Queue) => Promise<void>;
}

const SITES: Record<string, Site> = {
  'embed-sync': {
    jobId: 'embed-sync-7',
    enqueue: (q) => new EmbedSyncQueueService(q).enqueue(7, 'signup_created'),
  },
  'departure-grace': {
    jobId: 'depart-7-user-1',
    enqueue: (q) =>
      new DepartureGraceQueueService(q).enqueue(
        { eventId: 7, discordUserId: 'user-1', signupId: 3 },
        300_000,
      ),
  },
  'ad-hoc-grace': {
    jobId: 'grace-7',
    enqueue: (q) => new AdHocGracePeriodQueueService(q).enqueue(7, 60_000),
  },
  'ephemeral-idle': {
    jobId: 'ephemeral-idle-7',
    enqueue: (q) =>
      new EphemeralVoiceIdleQueueService(q).enqueue(
        { eventId: 7, channelId: 'chan-1' },
        60_000,
      ),
  },
};

function siteFor(name: string): Site {
  const site = SITES[name];
  if (!site) throw new Error(`unknown site ${name}`);
  return site;
}

const FINISHED_CASES = Object.keys(SITES).flatMap((site) =>
  (['completed', 'failed'] as const).map((state) => [site, state] as const),
);

describe('discord-bot fixed-jobId producers (ROK-1762 retained finished job)', () => {
  it.each(FINISHED_CASES)(
    '%s enqueues a new job when a %s job with the same id is retained',
    async (site, state) => {
      const { jobId, enqueue } = siteFor(site);
      const { queue, accepted } = makeFakeQueue(jobId, state);

      await enqueue(queue as unknown as Queue);

      expect(accepted).toEqual([expect.objectContaining({ jobId })]);
    },
  );

  it.each(Object.keys(SITES))(
    '%s never removes an active job with the same id',
    async (site) => {
      const { jobId, enqueue } = siteFor(site);
      const { queue, store } = makeFakeQueue(jobId, 'active');

      await enqueue(queue as unknown as Queue);

      expect(queue.remove).not.toHaveBeenCalled();
      expect(store.get(jobId)).toBe('active');
    },
  );

  it('embed-sync still coalesces into a pending delayed job (debounce kept)', async () => {
    const { jobId, enqueue } = siteFor('embed-sync');
    const { queue, accepted, store, changeDelay } = makeFakeQueue(
      jobId,
      'delayed',
    );

    await enqueue(queue as unknown as Queue);

    expect(changeDelay).toHaveBeenCalledWith(2_000);
    expect(queue.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(accepted).toEqual([]);
    expect(store.get(jobId)).toBe('delayed');
  });

  it('embed-sync leaves a waiting job alone and adds nothing', async () => {
    const { jobId, enqueue } = siteFor('embed-sync');
    const { queue, store } = makeFakeQueue(jobId, 'waiting');

    await enqueue(queue as unknown as Queue);

    expect(queue.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(store.get(jobId)).toBe('waiting');
  });
});
