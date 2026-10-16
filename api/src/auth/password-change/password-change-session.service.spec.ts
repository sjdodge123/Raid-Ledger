import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import type { TokenBlocklistService } from '../token-blocklist.service';
import type { RefreshTokenService } from '../refresh/refresh-token.service';
import { PasswordChangeSessionService } from './password-change-session.service';

const CALLER = { id: 7, username: 'admin', role: 'admin' as const };
const ISSUED = { rawToken: 'raw', maxAgeMs: 1000, userId: 7, familyId: 'fam' };

function build(blockSucceeds = true) {
  const calls: string[] = [];
  let blockedAt: number | undefined;
  const refresh = {
    revokeAllForUser: jest.fn(() => {
      calls.push('revokeAllForUser');
      return Promise.resolve();
    }),
    issue: jest.fn(() => {
      calls.push('issue');
      return Promise.resolve(ISSUED);
    }),
  };
  const blocklist = {
    // Mirrors TokenBlocklistService: stamps floor(now); floor = stamp + 1.
    blockUser: jest.fn(() => {
      calls.push('blockUser');
      if (blockSucceeds) blockedAt = Math.floor(Date.now() / 1000);
      return Promise.resolve(blockSucceeds);
    }),
    minIatFor: jest.fn(() =>
      Promise.resolve(blockedAt === undefined ? undefined : blockedAt + 1),
    ),
  };
  const jwt = new JwtService({ secret: 'test-secret' });
  const service = new PasswordChangeSessionService(
    refresh as unknown as RefreshTokenService,
    blocklist as unknown as TokenBlocklistService,
    jwt,
  );
  return {
    service,
    refresh,
    blocklist,
    jwt,
    calls,
    blockedAt: () => blockedAt,
  };
}

describe('ROK-1810 PasswordChangeSessionService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('revokes refresh families BEFORE blocklisting, and issues nothing', async () => {
    const t = build();
    await t.service.revokeAllSessions(42);
    expect(t.calls).toEqual(['revokeAllForUser', 'blockUser']);
    expect(t.blocklist.blockUser).toHaveBeenCalledWith(42);
    expect(t.refresh.issue).not.toHaveBeenCalled();
  });

  it('logs at error level when the blocklist write failed, after the refresh revoke', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const t = build(false);
    await t.service.revokeAllSessions(42);
    expect(t.refresh.revokeAllForUser).toHaveBeenCalledWith(42);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('blocklist write failed'),
    );
  });

  it('issueSession mints a local refresh family and the caller claims', async () => {
    const t = build();
    const session = await t.service.issueSession(CALLER, 'UA/1');
    expect(t.refresh.issue).toHaveBeenCalledWith(7, {
      authMethod: 'local',
      userAgent: 'UA/1',
    });
    expect(session.refresh).toBe(ISSUED);
    expect(t.jwt.decode(session.accessToken)).toMatchObject({
      sub: 7,
      username: 'admin',
      role: 'admin',
    });
  });

  it('the re-issued token, minted in the block second, has an iat the block cannot reject', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-16T12:00:00.250Z') });
    const t = build();
    await t.service.revokeAllSessions(CALLER.id);
    const { accessToken } = await t.service.issueSession(CALLER, null);
    const { iat } = t.jwt.decode<{ iat: number }>(accessToken);
    // TokenBlocklistService.isBlocked rejects `iat <= blockedAt`.
    expect(iat).toBe((t.blockedAt() ?? Number.NaN) + 1);
  });
});
