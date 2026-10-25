import type { Queue } from 'bullmq';
import type { SettingsService } from '../../../settings/settings.service';
import { SteamStatsLinkListener } from './steam-stats-link.listener';

function setup(configured: boolean) {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const settings = {
    isSteamConfigured: jest.fn().mockResolvedValue(configured),
  };
  const listener = new SteamStatsLinkListener(
    settings as unknown as SettingsService,
    queue as unknown as Queue,
  );
  return { listener, queue };
}

const EVENT = { userId: 42, steamId64: '76561190000000001' };

describe('SteamStatsLinkListener (ROK-1953 D6)', () => {
  it('L1 — Steam configured: enqueues a link refresh with the deduped job id', async () => {
    const { listener, queue } = setup(true);
    await listener.handleLinked(EVENT);
    expect(queue.add).toHaveBeenCalledWith(
      'link',
      { trigger: 'link', userId: 42 },
      expect.objectContaining({ jobId: 'steam-stats-link-42' }),
    );
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
});
