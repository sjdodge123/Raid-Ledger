/**
 * ROK-1749 — the admin "User deactivated" notification names the layer that
 * fired the deactivation (reason), so a deactivation can be attributed.
 */
import { Logger } from '@nestjs/common';
import {
  deactivateUserOrchestrated,
  deactivationMessage,
  type DeactivationReason,
} from './discord-notification-deactivate.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';

async function runWith(reason?: DeactivationReason): Promise<jest.Mock> {
  const db = createDrizzleMock();
  db.returning.mockResolvedValueOnce([{ id: 7, username: 'bob' }]);
  const create = jest.fn().mockResolvedValue(undefined);
  const logger = new Logger('test');
  jest.spyOn(logger, 'log').mockImplementation();
  jest.spyOn(logger, 'warn').mockImplementation();
  await deactivateUserOrchestrated(
    {
      db: db as never,
      logger,
      usersService: {
        findAdmin: jest.fn().mockResolvedValue({ id: 1 }),
      } as never,
      notificationService: { create } as never,
      rosterService: {} as never,
    },
    7,
    reason,
  );
  return create;
}

describe('deactivation reason (ROK-1749)', () => {
  it('renders the sweep reason into the admin notification', async () => {
    const create = await runWith('reconciliation-sweep');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'user_deactivated_discord',
        message:
          'bob was deactivated by the daily guild sweep (not in the member list).',
        payload: expect.objectContaining({ reason: 'reconciliation-sweep' }),
      }),
    );
  });

  it('renders the 50278 reason', async () => {
    const create = await runWith('dm-failure-50278');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'bob was deactivated because a DM was refused (50278).',
      }),
    );
  });

  it('defaults to the legacy wording when no reason is given', async () => {
    const create = await runWith();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'bob left the Discord guild and was deactivated.',
        payload: expect.objectContaining({ reason: 'unknown' }),
      }),
    );
  });

  it('maps every reason to a distinct message', () => {
    const reasons: DeactivationReason[] = [
      'reconciliation-sweep',
      'dm-failure-50278',
      'dm-failure-10013',
      'manual',
      'unknown',
    ];
    const msgs = new Set(reasons.map((r) => deactivationMessage('x', r)));
    expect(msgs.size).toBe(reasons.length);
  });
});
