/**
 * ROK-1442: the private-lineup milestone DM mirrors the channel embed, so it
 * must not tell invitees to keep adding games once the cap is full.
 */
import { sendMilestoneDM } from './lineup-notification-private-dm.helpers';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';

describe('sendMilestoneDM — the cap is a ceiling (ROK-1442)', () => {
  const create = jest.fn().mockResolvedValue(undefined);
  const notificationService = { create } as unknown as NotificationService;
  const dedupService = {
    checkAndMarkSent: jest.fn().mockResolvedValue(false),
  } as unknown as NotificationDedupService;
  const member = { userId: 7, discordId: '7' } as never;

  beforeEach(() => create.mockClear());

  async function sent(threshold: number, count: number) {
    await sendMilestoneDM(
      notificationService,
      dedupService,
      { id: 1, title: 'Sept' },
      threshold,
      count,
      member,
    );
    return create.mock.calls[0][0] as { title: string; message: string };
  }

  it('50%: still encourages more nominations', async () => {
    const dm = await sent(50, 10);
    expect(dm.title).toContain('50%');
    expect(dm.message).toContain('Keep adding games');
  });

  it('100%: says nominations are full and never asks for more games', async () => {
    const dm = await sent(100, 20);
    expect(dm.title).toContain('Nominations are full');
    expect(dm.message).toContain('no more games can be added');
    expect(dm.message).not.toContain('Keep adding');
  });
});
