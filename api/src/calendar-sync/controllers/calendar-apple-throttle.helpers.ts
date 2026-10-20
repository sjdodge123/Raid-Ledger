/**
 * ROK-1598 D13: at most 5 Apple connect attempts per user per 10 minutes.
 *
 * Not `@Throttle`: the global `ThrottlerGuard` is an APP_GUARD, which runs
 * BEFORE the route's `AuthGuard('jwt')`, so it can only key by IP — and a
 * guild behind one NAT would share one bucket. This window is keyed by the
 * authenticated user id and checked after the JWT guard. In memory: the
 * deployment is a single API process (allinone). `THROTTLE_DISABLED` is read
 * per call so integration specs can turn it on for one case.
 */
export const APPLE_CONNECT_LIMIT = 5;
export const APPLE_CONNECT_WINDOW_MS = 10 * 60 * 1000;

export class PerUserAttemptWindow {
  private readonly attempts = new Map<number, number[]>();

  constructor(
    private readonly limit = APPLE_CONNECT_LIMIT,
    private readonly windowMs = APPLE_CONNECT_WINDOW_MS,
  ) {}

  /** Records the attempt; false = over the limit (nothing recorded). */
  tryAttempt(userId: number, nowMs: number = Date.now()): boolean {
    if (process.env.THROTTLE_DISABLED === 'true') return true;
    const since = nowMs - this.windowMs;
    const recent = (this.attempts.get(userId) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.attempts.set(userId, recent);
      return false;
    }
    recent.push(nowMs);
    this.attempts.set(userId, recent);
    this.prune(since);
    return true;
  }

  /** Drop users whose every attempt has aged out (bounded memory). */
  private prune(since: number): void {
    for (const [user, times] of this.attempts) {
      if (!times.some((t) => t > since)) this.attempts.delete(user);
    }
  }
}
