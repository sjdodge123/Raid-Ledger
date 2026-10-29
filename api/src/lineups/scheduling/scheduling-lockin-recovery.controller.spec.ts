/**
 * ROK-2033 — the admin reopen route is admin-only (RolesGuard is
 * hierarchical, so `'admin'` excludes operators) and delegates to the service.
 * The HTTP 403/409/200 matrix is the integration spec's job.
 */
import { RolesGuard } from '../../auth/roles.guard';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { SchedulingLockInRecoveryController } from './scheduling-lockin-recovery.controller';

const handler = SchedulingLockInRecoveryController.prototype.reopenLockIn;

describe('SchedulingLockInRecoveryController', () => {
  it('requires the admin role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['admin']);
  });

  it('runs the JWT, not-deactivated and roles guards', () => {
    const guards: unknown[] = Reflect.getMetadata('__guards__', handler);
    expect(guards).toHaveLength(3);
    expect(guards).toEqual(
      expect.arrayContaining([NotDeactivatedGuard, RolesGuard]),
    );
  });

  it('reopens as the requesting admin', async () => {
    const body = {
      matchId: 4,
      status: 'scheduling' as const,
      discardedEventIds: [],
    };
    const recovery = { reopenByAdmin: jest.fn().mockResolvedValue(body) };
    const controller = new SchedulingLockInRecoveryController(
      recovery as never,
    );
    expect(await controller.reopenLockIn(4, { user: { id: 42 } })).toBe(body);
    expect(recovery.reopenByAdmin).toHaveBeenCalledWith(4, 42);
  });
});
