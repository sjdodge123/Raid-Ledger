import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  PROPOSE_LIMIT,
  PROPOSE_WINDOW_MS,
  ProposalThrottleGuard,
  requestIsStaff,
  requestUserId,
} from './proposal-throttle.guard';

function ctxFor(user: { id: number; role: string }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

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

  it('ROK-2017: staff are never throttled; members still are', () => {
    const guard = new ProposalThrottleGuard();
    for (const role of ['admin', 'operator']) {
      const ctx = ctxFor({ id: role === 'admin' ? 10 : 11, role });
      for (let i = 0; i <= PROPOSE_LIMIT + 1; i += 1) {
        expect(guard.canActivate(ctx)).toBe(true);
      }
    }
    const member = ctxFor({ id: 12, role: 'member' });
    for (let i = 0; i < PROPOSE_LIMIT; i += 1) guard.canActivate(member);
    expect(() => guard.canActivate(member)).toThrow(ThrottlerException);
  });

  it('ROK-2017: reads staff off the authenticated request only', () => {
    expect(requestIsStaff({ user: { id: 1, role: 'admin' } })).toBe(true);
    expect(requestIsStaff({ user: { id: 1, role: 'operator' } })).toBe(true);
    expect(requestIsStaff({ user: { id: 1, role: 'member' } })).toBe(false);
    expect(requestIsStaff({ user: { id: 1 } })).toBe(false);
    expect(requestIsStaff({})).toBe(false);
    expect(requestIsStaff(null)).toBe(false);
  });
});
