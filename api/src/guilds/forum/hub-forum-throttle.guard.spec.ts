/**
 * ROK-1175 Q10 — 10 forum creates per user per minute PER HUB: the bucket
 * is keyed on user + the route's hub id, so one hub's activity never spends
 * another hub's quota.
 */
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { HUB_POST_CREATE_LIMIT } from '../posts/hub-post-throttle.guard';
import { HubForumThrottleGuard } from './hub-forum-throttle.guard';

/** A minimal HTTP context carrying a user and the `:id` route param. */
function ctxFor(userId: number, hubId: string): ExecutionContext {
  const req = { user: { id: userId }, params: { id: hubId } };
  const http = { getRequest: () => req };
  return { switchToHttp: () => http } as unknown as ExecutionContext;
}

function spend(guard: HubForumThrottleGuard, ctx: ExecutionContext): void {
  for (let i = 0; i < HUB_POST_CREATE_LIMIT; i += 1) guard.canActivate(ctx);
}

describe('ROK-1175 HubForumThrottleGuard — per user per hub', () => {
  it('10 creates in hub A leave hub B untouched', () => {
    const guard = new HubForumThrottleGuard();
    spend(guard, ctxFor(1, '10'));
    expect(() => guard.canActivate(ctxFor(1, '20'))).not.toThrow();
  });

  it('the 11th create in the same hub is refused', () => {
    const guard = new HubForumThrottleGuard();
    spend(guard, ctxFor(1, '10'));
    expect(() => guard.canActivate(ctxFor(1, '10'))).toThrow(
      ThrottlerException,
    );
  });

  it("another user's creates in the same hub do not count", () => {
    const guard = new HubForumThrottleGuard();
    spend(guard, ctxFor(1, '10'));
    expect(() => guard.canActivate(ctxFor(2, '10'))).not.toThrow();
  });

  it("'010' and '10' share one bucket (the id is normalised)", () => {
    const guard = new HubForumThrottleGuard();
    spend(guard, ctxFor(1, '10'));
    expect(() => guard.canActivate(ctxFor(1, '010'))).toThrow(
      ThrottlerException,
    );
  });

  it('a non-numeric hub id falls back to the per-user bucket', () => {
    const guard = new HubForumThrottleGuard();
    spend(guard, ctxFor(1, 'abc'));
    expect(() => guard.canActivate(ctxFor(1, 'xyz'))).toThrow(
      ThrottlerException,
    );
  });
});
