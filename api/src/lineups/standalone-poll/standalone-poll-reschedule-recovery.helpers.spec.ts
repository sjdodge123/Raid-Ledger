/**
 * ROK-2271 fix round 2 — the lock-in recovery path resets confirmations
 * through `EventsService.resetConfirmations`, the method that signals the
 * event thread around the write (so no false "confirmed" lines post).
 */
import type { RescheduleEventDto } from '@raid-ledger/contract';
import { createMockEvent } from '../../common/testing/factories';
import type * as schema from '../../drizzle/schema';
import type { NotificationService } from '../../notifications/notification.service';
import {
  finishMovedReschedule,
  type RescheduleRecoveryDeps,
} from './standalone-poll-reschedule-recovery.helpers';

const DTO: RescheduleEventDto = {
  startTime: '2026-12-01T20:00:00.000Z',
  endTime: '2026-12-01T22:00:00.000Z',
};

function deps(resetConfirmations: jest.Mock): RescheduleRecoveryDeps {
  // rescheduleNotified finds this move's rows: the notification is skipped.
  const limit = jest.fn().mockResolvedValue([{ id: 1 }]);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  return {
    db: { select: jest.fn(() => ({ from })) } as never,
    eventsService: { resetConfirmations },
    notificationService: {} as NotificationService,
    logger: { error: jest.fn() },
  };
}

describe('finishMovedReschedule — ROK-2271 reset signal', () => {
  it('resets through EventsService.resetConfirmations (signalled), excluding the caller', async () => {
    const resetConfirmations = jest.fn().mockResolvedValue(undefined);
    const before = createMockEvent({
      id: 9,
    }) as unknown as typeof schema.events.$inferSelect;
    await finishMovedReschedule(deps(resetConfirmations), {
      eventId: 9,
      caller: { id: 3, isAdmin: false },
      before,
      dto: DTO,
    });
    expect(resetConfirmations).toHaveBeenCalledWith(9, 3);
  });
});
