import type { JwtService } from '@nestjs/jwt';
import type { TokenBlocklistService } from '../token-blocklist.service';
import type { RefreshTokenService } from '../refresh/refresh-token.service';
import {
  PasswordChangeSessionService,
  firstSecondAfterBlock,
} from './password-change-session.service';

const CALLER = { id: 7, username: 'admin', role: 'admin' as const };
const ISSUED = { rawToken: 'raw', maxAgeMs: 1000, userId: 7, familyId: 'fam' };

function build() {
  const calls: string[] = [];
  let blockedAt = 0;
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
    // Mirrors TokenBlocklistService.blockUser: stamps floor(now) seconds.
    blockUser: jest.fn(() => {
      calls.push('blockUser');
      blockedAt = Math.floor(Date.now() / 1000);
      return Promise.resolve();
    }),
  };
  const jwt = {
    sign: jest.fn(() => {
      calls.push('sign');
      return 'fresh.jwt';
    }),
  };
  const service = new PasswordChangeSessionService(
    refresh as unknown as RefreshTokenService,
    blocklist as unknown as TokenBlocklistService,
    jwt as unknown as JwtService,
  );
  return { service, refresh, blocklist, jwt, calls, blockedAt: () => blockedAt };
}

describe('ROK-1810 PasswordChangeSessionService', () => {
  afterEach(() => jest.useRealTimers());

  it('revokes refresh families and blocklists the user', async () => {
    const t = build();
    await t.service.revokeAllSessions(42);
    expect(t.refresh.revokeAllForUser).toHaveBeenCalledWith(42);
    expect(t.blocklist.blockUser).toHaveBeenCalledWith(42);
    expect(t.refresh.issue).not.toHaveBeenCalled();
  });

  it('revokes and blocks BEFORE issuing and signing the new session', async () => {
    const t = build();
    const session = await t.service.revokeAndReissue(CALLER, 'UA/1');
    expect(t.calls).toEqual(['revokeAllForUser', 'blockUser', 'issue', 'sign']);
    expect(t.refresh.issue).toHaveBeenCalledWith(7, {
      authMethod: 'local',
      userAgent: 'UA/1',
    });
    expect(session).toEqual({ accessToken: 'fresh.jwt', refresh: ISSUED });
  });

  it('mints the new access token with an iat the block cannot reject, in the same second', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-16T12:00:00.250Z') });
    const t = build();
    await t.service.revokeAndReissue(CALLER, null);
    const payload = t.jwt.sign.mock.calls[0] as unknown as [{ iat?: number }];
    const iat = payload[0].iat;
    // TokenBlocklistService.isBlocked rejects `iat <= blockedAt`.
    expect(typeof iat).toBe('number');
    expect((iat ?? 0) > t.blockedAt()).toBe(true);
    expect(payload[0]).toMatchObject({ sub: 7, username: 'admin', role: 'admin' });
  });

  it('firstSecondAfterBlock is strictly after the stamp at every millisecond of a second', () => {
    const base = Date.parse('2026-10-16T12:00:00.000Z');
    for (const ms of [0, 1, 500, 999]) {
      const stamp = Math.floor((base + ms) / 1000);
      expect(firstSecondAfterBlock(base + ms)).toBe(stamp + 1);
    }
  });
});
