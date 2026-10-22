import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';

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
 * A fixed-window limit keyed on the authenticated user id (ROK-1870 D12,
 * generalised for ROK-1868). The global `ThrottlerGuard` tracks by client IP,
 * so behind the fleet/prod proxy every user shares one bucket. In-process,
 * like the throttler's default storage. Subclasses set `limit` + `windowMs`
 * and each guard class keeps its own buckets. Runs after `AuthGuard('jwt')`
 * (list it after the auth guard), so a user is present; a request without one
 * is left to the auth guard. A refusal is a `ThrottlerException` (429), so the
 * shared filter shapes the body.
 */
export abstract class PerUserThrottleGuard implements CanActivate {
  /** Requests allowed per user per window. */
  protected abstract readonly limit: number;
  /** The window length in ms. */
  protected abstract readonly windowMs: number;
  now: () => number = () => Date.now();
  private readonly windows = new Map<number, Window>();

  canActivate(context: ExecutionContext): boolean {
    const userId = requestUserId(context.switchToHttp().getRequest<unknown>());
    if (userId !== null) this.hit(userId);
    return true;
  }

  /** Count one request for `userId`; throws 429 once the window is spent. */
  hit(userId: number): void {
    const now = this.now();
    const live = this.windows.get(userId);
    if (live && now - live.startedAt < this.windowMs) {
      if (live.count >= this.limit) throw new ThrottlerException();
      live.count += 1;
      return;
    }
    if (this.windows.size >= MAX_KEYS) this.sweep(now);
    this.windows.set(userId, { startedAt: now, count: 1 });
  }

  /** Forget every bucket (integration specs reset between tests). */
  reset(): void {
    this.windows.clear();
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) {
      if (now - w.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
