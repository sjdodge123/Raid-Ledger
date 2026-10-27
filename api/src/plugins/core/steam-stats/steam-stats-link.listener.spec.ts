import type { Queue } from 'bullmq';
import type { SettingsService } from '../../../settings/settings.service';
import { SteamStatsLinkListener } from './steam-stats-link.listener';
import { RATE_LIMIT_BACKOFF_MS } from './steam-stats.constants';
import type { SteamStatsStorageRepository } from './steam-stats-storage.repository';

function setup(configured: boolean) {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const settings = {
    isSteamConfigured: jest.fn().mockResolvedValue(configured),
  };
  const storage = { purgeUser: jest.fn().mockResolvedValue(undefined) };
  const listener = new SteamStatsLinkListener(
    settings as unknown as SettingsService,
    queue as unknown as Queue,
    storage as unknown as SteamStatsStorageRepository,
  );
  return { listener, queue, storage };
}

const EVENT = { userId: 42, steamId64: '76561190000000001' };
const REPLACEMENT = { userId: 42, steamId64: '76561190000000002' };

/** The `jobId` of the n-th `queue.add` call. */
function jobIdOf(queue: { add: jest.Mock }, n: number): string {
  const opts = queue.add.mock.calls[n]?.[2] as { jobId?: string } | undefined;
  if (opts?.jobId === undefined) throw new Error(`queue.add call ${n} has no jobId`);
  return opts.jobId;
}

describe('SteamStatsLinkListener (ROK-1953 D6)', () => {
  it('L1 — Steam configured: enqueues a link refresh with the deduped job id', async () => {
    const { listener, queue } = setup(true);
    await listener.handleLinked(EVENT);
    expect(queue.add).toHaveBeenCalledWith(
      'link',
      { trigger: 'link', userId: 42 },
      expect.objectContaining({
        jobId: expect.stringMatching(/^steam-stats-link-42-[0-9a-f]{12}$/),
      }),
    );
  });

  it('L7 — a replacement account gets its own job id, so an active fetch for the old one cannot dedupe it away (Codex P2)', async () => {
    const { listener, queue } = setup(true);
    await listener.handleLinked(EVENT);
    await listener.handleLinked(EVENT);
    await listener.handleLinked(REPLACEMENT);
    expect(jobIdOf(queue, 1)).toBe(jobIdOf(queue, 0));
    expect(jobIdOf(queue, 2)).not.toBe(jobIdOf(queue, 0));
  });

  it('L8 — the job id never carries the raw SteamID', async () => {
    const { listener, queue } = setup(true);
    await listener.handleLinked(EVENT);
    expect(jobIdOf(queue, 0)).not.toContain(EVENT.steamId64);
  });

  it('L2 — no Steam key: nothing enqueued', async () => {
    const { listener, queue } = setup(false);
    await listener.handleLinked(EVENT);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('L3 — an enqueue failure is swallowed', async () => {
    const { listener, queue } = setup(true);
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(listener.handleLinked(EVENT)).resolves.toBeUndefined();
  });

  it('L4 — a link job retries like the nightly run (3 attempts, exponential backoff), so a 429 requeues', async () => {
    const { listener, queue } = setup(true);
    await listener.handleLinked(EVENT);
    expect(queue.add.mock.calls[0]?.[2]).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: RATE_LIMIT_BACKOFF_MS },
    });
  });

  it("L5 — unlink (also fired first when Steam is replaced) purges the user's cached stats, Steam key or not", async () => {
    const { listener, storage } = setup(false);
    await listener.handleUnlinked(EVENT);
    expect(storage.purgeUser).toHaveBeenCalledWith(42);
  });

  it('L6 — a purge failure is swallowed', async () => {
    const { listener, storage } = setup(true);
    storage.purgeUser.mockRejectedValueOnce(new Error('db down'));
    await expect(listener.handleUnlinked(EVENT)).resolves.toBeUndefined();
  });
});
