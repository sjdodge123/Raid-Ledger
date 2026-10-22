import { ThrottlerException } from '@nestjs/throttler';
import { PerUserThrottleGuard } from '../../common/throttle/per-user-throttle.guard';
import {
  HUB_POST_CREATE_LIMIT,
  HUB_POST_CREATE_WINDOW_MS,
  HubPostThrottleGuard,
} from './hub-post-throttle.guard';

function spend(guard: HubPostThrottleGuard, userId: number): void {
  for (let i = 0; i < HUB_POST_CREATE_LIMIT; i += 1) guard.hit(userId);
}

describe('ROK-1868 HubPostThrottleGuard — 10 creates/min per user', () => {
  it('is the shared per-user throttle, at 10 per minute', () => {
    const guard = new HubPostThrottleGuard();
    expect(guard).toBeInstanceOf(PerUserThrottleGuard);
    expect(HUB_POST_CREATE_LIMIT).toBe(10);
    expect(HUB_POST_CREATE_WINDOW_MS).toBe(60_000);
  });

  it("refuses the 11th create, without touching another user's bucket", () => {
    const guard = new HubPostThrottleGuard();
    spend(guard, 1);
    expect(() => guard.hit(1)).toThrow(ThrottlerException);
    expect(() => spend(guard, 2)).not.toThrow();
  });

  it('opens a fresh window after a minute', () => {
    const guard = new HubPostThrottleGuard();
    let t = 1_000;
    guard.now = () => t;
    spend(guard, 1);
    t += HUB_POST_CREATE_WINDOW_MS;
    expect(() => guard.hit(1)).not.toThrow();
  });

  it('reset() empties every bucket', () => {
    const guard = new HubPostThrottleGuard();
    spend(guard, 1);
    guard.reset();
    expect(() => guard.hit(1)).not.toThrow();
  });
});
