import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { NotDeactivatedGuard } from './not-deactivated.guard';
import type { AuthenticatedUser } from './types';

function buildContext(user: Partial<AuthenticatedUser> | undefined) {
  const request = user === undefined ? {} : { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 1,
    username: 'tester',
    role: 'member',
    discordId: null,
    deactivatedAt: null,
    impersonatedBy: null,
    ...overrides,
  };
}

describe('NotDeactivatedGuard', () => {
  let guard: NotDeactivatedGuard;

  beforeEach(() => {
    guard = new NotDeactivatedGuard();
  });

  it('allows an active user', () => {
    const ctx = buildContext(buildUser({ deactivatedAt: null }));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a deactivated user with 403 + USER_DEACTIVATED code', () => {
    const ctx = buildContext(buildUser({ deactivatedAt: new Date() }));
    expect.assertions(3);
    try {
      guard.canActivate(ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as {
        code?: string;
        message?: string;
      };
      expect(response.code).toBe('USER_DEACTIVATED');
      expect(response.message).toBe('Account deactivated');
    }
  });

  it('allows an impersonated-deactivated user (admin acting on behalf of)', () => {
    const ctx = buildContext(
      buildUser({ deactivatedAt: new Date(), impersonatedBy: 99 }),
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns false when no user is attached to the request', () => {
    expect(guard.canActivate(buildContext(undefined))).toBe(false);
  });
});
