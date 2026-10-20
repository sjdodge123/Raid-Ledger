import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import type { TokenBlocklistService } from '../token-blocklist.service';
import type { RefreshTokenService } from '../refresh/refresh-token.service';
import { PasswordChangeSessionService } from './password-change-session.service';

const CALLER = { id: 7, username: 'admin', role: 'admin' as const };
const ISSUED = { rawToken: 'raw', maxAgeMs: 1000, userId: 7, familyId: 'fam' };
/** The version `revokeAllAndBump` returns (ROK-1823). */
const BUMPED = 5;

function build(blockSucceeds = true) {
  const calls: string[] = [];
  const refresh = {
    revokeAllAndBump: jest.fn(() => {
      calls.push('revokeAllAndBump');
      return Promise.resolve(BUMPED);
    }),
    issue: jest.fn(() => {
      calls.push('issue');
      return Promise.resolve(ISSUED);
    }),
  };
  const blocklist = {
    // ROK-1823 D10: the mint no longer reads a block floor (no minIatFor).
    blockUser: jest.fn(() => {
      calls.push('blockUser');
      return Promise.resolve(blockSucceeds);
    }),
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
  };
}

describe('ROK-1810 PasswordChangeSessionService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('revokes + bumps BEFORE blocklisting, and issues nothing', async () => {
    const t = build();
    await t.service.revokeAllSessions(42);
    expect(t.calls).toEqual(['revokeAllAndBump', 'blockUser']);
    expect(t.refresh.revokeAllAndBump).toHaveBeenCalledWith(42);
    expect(t.blocklist.blockUser).toHaveBeenCalledWith(42);
    expect(t.refresh.issue).not.toHaveBeenCalled();
  });

  it('logs at error level when the blocklist write failed, after the refresh revoke', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const t = build(false);
    await t.service.revokeAllSessions(42);
    expect(t.refresh.revokeAllAndBump).toHaveBeenCalledWith(42);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('blocklist write failed'),
    );
  });

  it('issueSession mints a local refresh family and the caller claims', async () => {
    const t = build();
    const session = await t.service.issueSession(CALLER, 'UA/1', BUMPED);
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
});

describe('ROK-1823 PasswordChangeSessionService token version', () => {
  afterEach(() => jest.restoreAllMocks());

  it('revokeAllSessions returns the version the revoke bumped to', async () => {
    const t = build();
    await expect(t.service.revokeAllSessions(42)).resolves.toBe(BUMPED);
  });

  it('still returns the bumped version when the legacy blocklist write fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const t = build(false);
    await expect(t.service.revokeAllSessions(42)).resolves.toBe(BUMPED);
  });

  it('issueSession signs the version it is handed as the tv claim', async () => {
    const t = build();
    const tv = await t.service.revokeAllSessions(CALLER.id);
    const { accessToken } = await t.service.issueSession(CALLER, null, tv);
    expect(t.jwt.decode<{ tv?: number }>(accessToken).tv).toBe(BUMPED);
  });

  it('a failed revoke+bump throws and blocklists nothing', async () => {
    const t = build();
    t.refresh.revokeAllAndBump.mockRejectedValueOnce(new Error('tx failed'));
    await expect(t.service.revokeAllSessions(42)).rejects.toThrow('tx failed');
    expect(t.blocklist.blockUser).not.toHaveBeenCalled();
  });
});
