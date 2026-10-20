import { ThrottlerException } from '@nestjs/throttler';
import {
  PROPOSE_LIMIT,
  PROPOSE_WINDOW_MS,
  ProposalThrottleGuard,
  requestUserId,
} from './proposal-throttle.guard';

function spend(guard: ProposalThrottleGuard, userId: number): void {
  for (let i = 0; i < PROPOSE_LIMIT; i += 1) guard.hit(userId);
}

describe('ROK-1870 ProposalThrottleGuard — 5/h per user (verify BLOCKED 14)', () => {
  it('gives each user their own 5 proposals', () => {
    const guard = new ProposalThrottleGuard();
    spend(guard, 1);
    expect(() => guard.hit(1)).toThrow(ThrottlerException);
    expect(() => spend(guard, 2)).not.toThrow();
    expect(() => guard.hit(2)).toThrow(ThrottlerException);
  });

  it('opens a fresh window after an hour', () => {
    const guard = new ProposalThrottleGuard();
    let t = 1_000;
    guard.now = () => t;
    spend(guard, 1);
    t += PROPOSE_WINDOW_MS;
    expect(() => guard.hit(1)).not.toThrow();
  });

  it('reads the user id off the authenticated request only', () => {
    expect(requestUserId({ user: { id: 7 } })).toBe(7);
    expect(requestUserId({ user: { id: '7' } })).toBeNull();
    expect(requestUserId({})).toBeNull();
    expect(requestUserId(null)).toBeNull();
  });
});
