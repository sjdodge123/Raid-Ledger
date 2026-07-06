import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import {
  suspendedRedirectReason,
  DiscordAuthGuard,
} from './discord-auth.helpers';
import {
  USER_SUSPENDED_CODE,
  USER_KICKED_CODE,
} from '../../auth/auth-status.helpers';

describe('suspendedRedirectReason (ROK-313 AC4)', () => {
  it('returns the ban reason for a USER_SUSPENDED error', () => {
    const err = new ForbiddenException({
      code: USER_SUSPENDED_CODE,
      message: 'x',
      reason: 'spamming',
    });
    expect(suspendedRedirectReason(err)).toBe('spamming');
  });

  it('returns "" for a USER_SUSPENDED error with no reason', () => {
    const err = new ForbiddenException({
      code: USER_SUSPENDED_CODE,
      message: 'x',
      reason: null,
    });
    expect(suspendedRedirectReason(err)).toBe('');
  });

  it('returns the cooldown message for a USER_KICKED error', () => {
    const err = new UnauthorizedException({
      code: USER_KICKED_CODE,
      message: 'cooldown msg',
      reason: 'cooldown msg',
    });
    expect(suspendedRedirectReason(err)).toBe('cooldown msg');
  });

  it('returns null for a non-suspension error (falls through to oauth_failed)', () => {
    expect(suspendedRedirectReason(new Error('boom'))).toBeNull();
    expect(
      suspendedRedirectReason(new UnauthorizedException('Invalid credentials')),
    ).toBeNull();
  });
});

function mockContext(res: { redirect: jest.Mock }): ExecutionContext {
  const req = { query: {}, headers: {} };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

describe('DiscordAuthGuard.handleRequest — suspension redirect (ROK-313 §9.7)', () => {
  const guard = new DiscordAuthGuard();

  it('redirects suspended/kicked failures to /login?error=suspended&reason=', () => {
    const res = { redirect: jest.fn() };
    const err = new ForbiddenException({
      code: USER_SUSPENDED_CODE,
      message: 'x',
      reason: 'spam',
    });

    guard.handleRequest(err, false, null, mockContext(res));

    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/login?error=suspended&reason=spam'),
    );
  });

  it('redirects generic OAuth failures to /login?error=oauth_failed', () => {
    const res = { redirect: jest.fn() };

    guard.handleRequest(new Error('boom'), false, null, mockContext(res));

    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/login?error=oauth_failed'),
    );
  });
});
