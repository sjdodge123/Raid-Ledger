import { ExecutionContext, Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../../common/throttle/per-user-throttle.guard';

export { requestUserId } from '../../common/throttle/per-user-throttle.guard';

/** D12: proposal POSTs allowed per user per window (lifted when THROTTLE_DISABLED, as every tier). */
export const PROPOSE_LIMIT =
  process.env.THROTTLE_DISABLED === 'true' ? 999_999 : 5;
/** D12: the proposal window — one hour. */
export const PROPOSE_WINDOW_MS = 3_600_000;

/** True when the authenticated request user is an admin or operator. */
export function requestIsStaff(req: unknown): boolean {
  if (typeof req !== 'object' || req === null || !('user' in req)) return false;
  const user = req.user;
  if (typeof user !== 'object' || user === null || !('role' in user)) {
    return false;
  }
  return user.role === 'admin' || user.role === 'operator';
}

/**
 * ROK-1870 D12 — the 5/h proposal limit, keyed on the authenticated user id
 * (verify lane 2, BLOCKED 14: the per-IP throttler gave every user behind the
 * proxy one bucket). Mechanics live in `PerUserThrottleGuard`. ROK-2017: staff
 * (`isStaff` — their proposals skip review) are not counted.
 */
@Injectable()
export class ProposalThrottleGuard extends PerUserThrottleGuard {
  protected readonly limit = PROPOSE_LIMIT;
  protected readonly windowMs = PROPOSE_WINDOW_MS;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<unknown>();
    return requestIsStaff(req) || super.canActivate(context);
  }
}
