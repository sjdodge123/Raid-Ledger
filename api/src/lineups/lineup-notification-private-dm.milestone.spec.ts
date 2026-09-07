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
  /** 2026-09-12T20:00:00Z as a literal so the assertion cannot self-agree. */
  const DEADLINE = new Date('2026-09-12T20:00:00.000Z');
  const DEADLINE_UNIX = 1789243200;

  beforeEach(() => create.mockClear());

  async function sent(
    threshold: number,
    count: number,
    lineup: Partial<Parameters<typeof sendMilestoneDM>[2]> = {},
  ) {
    await sendMilestoneDM(
      notificationService,
      dedupService,
      { id: 1, title: 'Sept', ...lineup },
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

  // ROK-1513: the DM must name the SAME deadline the channel embed names.
  it('100% with a deadline: names the real phase deadline as when voting opens', async () => {
    const dm = await sent(100, 20, { phaseDeadline: DEADLINE });
    expect(dm.message).toContain(
      `Voting opens <t:${DEADLINE_UNIX}:R> (<t:${DEADLINE_UNIX}:f>)`,
    );
    expect(dm.message).not.toContain('when the nomination window closes');
  });

  it('100% with a nomination target: says "at the latest" instead of a fixed opening time', async () => {
    const dm = await sent(100, 20, {
      phaseDeadline: DEADLINE,
      nominationTargetPct: 60,
    });
    expect(dm.message).toContain(
      `by <t:${DEADLINE_UNIX}:f> at the latest`,
    );
    expect(dm.message).not.toContain(`<t:${DEADLINE_UNIX}:R>`);
  });

  it('100% without a deadline: keeps the honest fallback', async () => {
    const dm = await sent(100, 20);
    expect(dm.message).toContain('Voting opens when the nomination window closes');
    expect(dm.message).not.toContain('<t:');
  });
});
