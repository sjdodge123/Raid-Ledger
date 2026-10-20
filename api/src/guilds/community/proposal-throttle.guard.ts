import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';

/** D12: proposal POSTs allowed per user per window (lifted when THROTTLE_DISABLED, as every tier). */
export const PROPOSE_LIMIT =
  process.env.THROTTLE_DISABLED === 'true' ? 999_999 : 5;
/** D12: the proposal window — one hour. */
export const PROPOSE_WINDOW_MS = 3_600_000;
/** Live-key cap; past it, expired windows are swept before a new key lands. */
const MAX_KEYS = 10_000;

interface Window {
  startedAt: number;
  count: number;
}

/** The authenticated user's id off a request, or null when there is none. */
export function requestUserId(req: unknown): number | null {
  if (typeof req !== 'object' || req === null || !('user' in req)) return null;
  const user = req.user;
  if (typeof user !== 'object' || user === null || !('id' in user)) return null;
  return typeof user.id === 'number' ? user.id : null;
}

/**
 * ROK-1870 D12 — the 5/h proposal limit, keyed on the authenticated user id.
 * The global `ThrottlerGuard` tracks by client IP, so behind the fleet/prod
 * proxy every user shared one bucket (verify lane 2, BLOCKED 14). In-process
 * fixed window, like the throttler's default storage. Runs after
 * `AuthGuard('jwt')` (class guards first), so a user is always present; a
 * request without one is left to the auth guard. A refusal is a
 * `ThrottlerException` (429), so the shared filter shapes the body.
 */
@Injectable()
export class ProposalThrottleGuard implements CanActivate {
  now: () => number = () => Date.now();
  private readonly windows = new Map<number, Window>();

  canActivate(context: ExecutionContext): boolean {
    const userId = requestUserId(context.switchToHttp().getRequest<unknown>());
    if (userId !== null) this.hit(userId);
    return true;
  }

  /** Count one proposal for `userId`; throws 429 once the window is spent. */
  hit(userId: number): void {
    const now = this.now();
    const live = this.windows.get(userId);
    if (live && now - live.startedAt < PROPOSE_WINDOW_MS) {
      if (live.count >= PROPOSE_LIMIT) throw new ThrottlerException();
      live.count += 1;
      return;
    }
    if (this.windows.size >= MAX_KEYS) this.sweep(now);
    this.windows.set(userId, { startedAt: now, count: 1 });
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) {
      if (now - w.startedAt >= PROPOSE_WINDOW_MS) this.windows.delete(key);
    }
  }
}
