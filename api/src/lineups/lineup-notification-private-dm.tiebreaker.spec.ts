/**
 * ROK-1784: a persisted DM is read long after it is sent, so the tiebreaker
 * round deadline is absolute (`<t:…:f>`). A relative `:R` would read
 * "closes an hour ago" once the moment passes.
 */
import { sendTiebreakerOpenDM } from './lineup-notification-private-dm.helpers';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';

describe('sendTiebreakerOpenDM — absolute round deadline (ROK-1784)', () => {
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

  it('names the round deadline as <t:…:f> with no relative :R token', async () => {
    await sendTiebreakerOpenDM(
      notificationService,
      dedupService,
      { id: 1, title: 'Sept' },
      { id: 3, mode: 'bracket', roundDeadline: DEADLINE },
      member,
    );
    const dm = create.mock.calls[0]?.[0] as { message: string } | undefined;
    expect(dm?.message).toContain(`Round closes <t:${DEADLINE_UNIX}:f>.`);
    expect(dm?.message).not.toMatch(/<t:\d+:R>/);
  });
});
