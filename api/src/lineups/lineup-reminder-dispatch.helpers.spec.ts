/**
 * Unit spec for the manual "remind voters" dispatch helper (ROK-1395).
 *
 * Pins the dedup key shape + TTL and the cron-compatible payload subtype —
 * the web click-through (/community-lineup/:lineupId/schedule/:matchId)
 * depends on BOTH ids being present in the payload.
 */
import { sendManualSchedulingReminder } from './lineup-reminder-dispatch.helpers';
import { MANUAL_REMIND_RECIPIENT_TTL } from './lineup-notification.constants';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';

interface MockDeps {
  notificationService: { create: jest.Mock };
  dedupService: { checkAndMarkSent: jest.Mock };
}

function makeDeps(): MockDeps {
  return {
    // create() resolves a DTO on success and null when the recipient's
    // preferences suppress the notification (the helper counts that as
    // not-sent).
    notificationService: { create: jest.fn().mockResolvedValue({ id: '1' }) },
    dedupService: { checkAndMarkSent: jest.fn() },
  };
}

function asDispatchDeps(deps: MockDeps) {
  return {
    notificationService:
      deps.notificationService as unknown as NotificationService,
    dedupService: deps.dedupService as unknown as NotificationDedupService,
  };
}

describe('sendManualSchedulingReminder (ROK-1395)', () => {
  it('sends once with the manual dedup key and cron-compatible payload', async () => {
    const deps = makeDeps();
    deps.dedupService.checkAndMarkSent.mockResolvedValue(false);

    const sent = await sendManualSchedulingReminder(
      asDispatchDeps(deps),
      7,
      42,
      99,
    );

    expect(sent).toBe(true);
    expect(deps.dedupService.checkAndMarkSent).toHaveBeenCalledWith(
      'lineup-sched-manual-remind:42:99',
      MANUAL_REMIND_RECIPIENT_TTL,
    );
    expect(deps.notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        type: 'community_lineup',
        title: 'Scheduling Reminder',
        payload: {
          subtype: 'lineup_scheduling_reminder',
          lineupId: 7,
          matchId: 42,
        },
      }),
    );
  });

  it('returns false and creates nothing when the recipient is deduped', async () => {
    const deps = makeDeps();
    deps.dedupService.checkAndMarkSent.mockResolvedValue(true);

    const sent = await sendManualSchedulingReminder(
      asDispatchDeps(deps),
      7,
      42,
      99,
    );

    expect(sent).toBe(false);
    expect(deps.notificationService.create).not.toHaveBeenCalled();
  });

  it('returns false when create() is suppressed by notification prefs', async () => {
    const deps = makeDeps();
    deps.dedupService.checkAndMarkSent.mockResolvedValue(false);
    deps.notificationService.create.mockResolvedValue(null);

    const sent = await sendManualSchedulingReminder(
      asDispatchDeps(deps),
      7,
      42,
      99,
    );

    expect(sent).toBe(false);
  });
});
