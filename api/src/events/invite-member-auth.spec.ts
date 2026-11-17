/**
 * ROK-2217 — who may send member invites, and how often. Route-level proof
 * (real DB, real guards) lives in event-invite-member-auth.integration.spec.ts.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerException } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { isEventSignup } from '../guilds/forum/event-discussion/event-discussion.queries';
import {
  assertCanInviteMembers,
  INVITE_MEMBER_FORBIDDEN_MESSAGE,
} from './event-invite.helpers';
import { EventsController } from './events.controller';
import {
  INVITE_MEMBER_LIMIT,
  InviteMemberThrottleGuard,
} from './invite-member-throttle.guard';

jest.mock('../guilds/forum/event-discussion/event-discussion.queries', () => ({
  isEventSignup: jest.fn(),
}));

const signedUp = jest.mocked(isEventSignup);
const db = {} as PostgresJsDatabase<typeof schema>;
const EVENT = { id: 7, creator: { id: 1 } };

function ctxFor(userId: number): ExecutionContext {
  const req = { user: { id: userId } };
  const http = { getRequest: () => req };
  return { switchToHttp: () => http } as unknown as ExecutionContext;
}

describe('ROK-2217 assertCanInviteMembers', () => {
  beforeEach(() => signedUp.mockReset());

  it('lets the event creator invite without a signup lookup', async () => {
    await expect(assertCanInviteMembers(db, EVENT, 1, false)).resolves.toBe(
      undefined,
    );
    expect(signedUp).not.toHaveBeenCalled();
  });

  it('lets operators/admins invite on any event', async () => {
    await expect(assertCanInviteMembers(db, EVENT, 2, true)).resolves.toBe(
      undefined,
    );
  });

  it('lets a non-manager with a writable signup invite', async () => {
    signedUp.mockResolvedValue(true);
    await expect(assertCanInviteMembers(db, EVENT, 3, false)).resolves.toBe(
      undefined,
    );
    expect(signedUp).toHaveBeenCalledWith(db, 7, 3);
  });

  it('refuses a non-manager without a writable signup with a 403', async () => {
    signedUp.mockResolvedValue(false);
    const err = await assertCanInviteMembers(db, EVENT, 4, false).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err instanceof ForbiddenException ? err.message : err).toBe(
      INVITE_MEMBER_FORBIDDEN_MESSAGE,
    );
  });
});

describe('ROK-2217 InviteMemberThrottleGuard', () => {
  it('invite-member carries the per-user invite throttle after auth', () => {
    const guards: unknown = Reflect.getMetadata(
      GUARDS_METADATA,
      EventsController.prototype.inviteMember,
    );
    expect(Array.isArray(guards) ? guards.at(-1) : guards).toBe(
      InviteMemberThrottleGuard,
    );
  });

  it('refuses the 11th invite in a minute, per user', () => {
    const guard = new InviteMemberThrottleGuard();
    for (let i = 0; i < INVITE_MEMBER_LIMIT; i += 1) {
      guard.canActivate(ctxFor(1));
    }
    expect(() => guard.canActivate(ctxFor(1))).toThrow(ThrottlerException);
    expect(() => guard.canActivate(ctxFor(2))).not.toThrow();
  });
});
