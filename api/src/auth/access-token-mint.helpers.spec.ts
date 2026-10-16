/**
 * ROK-1810 Codex P2: an access token minted in the same second as a
 * `blockUser` (a sibling tab's `/auth/refresh`, a fresh login) must not be
 * born revoked. Drives the real TokenBlocklistService over an in-memory Redis.
 */
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { TokenBlocklistService } from './token-blocklist.service';
import { mockRedisEval } from '../common/testing/redis-mock';
import { issuedAtFor, signAccessToken } from './access-token-mint.helpers';

const NOW = new Date('2026-10-16T12:00:00.250Z');
const CLAIMS = { username: 'admin', sub: 7, role: 'admin' as const };

function build() {
  const store = new Map<string, string>();
  const redis = {
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    eval: jest.fn(mockRedisEval(store, new Map<string, number>())),
  };
  const blocklist = new TokenBlocklistService(redis as unknown as Redis);
  const jwt = new JwtService({ secret: 'test-secret' });
  return { blocklist, jwt, redis };
}

function iatOf(jwt: JwtService, token: string): number {
  return jwt.decode<{ iat: number }>(token).iat;
}

describe('ROK-1810 signAccessToken — same-second mint after a block', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('a token minted in the block second is NOT rejected by isBlocked', async () => {
    const t = build();
    await t.blocklist.blockUser(CLAIMS.sub);
    const token = await signAccessToken(t, CLAIMS);
    const iat = iatOf(t.jwt, token);
    expect(await t.blocklist.isBlocked(CLAIMS.sub, iat)).toBe(false);
  });

  it('control: a plain sign in the block second IS rejected', async () => {
    const t = build();
    await t.blocklist.blockUser(CLAIMS.sub);
    const iat = iatOf(t.jwt, t.jwt.sign(CLAIMS));
    expect(await t.blocklist.isBlocked(CLAIMS.sub, iat)).toBe(true);
  });

  it('an impersonation token clears the impersonating admin block too', async () => {
    const t = build();
    await t.blocklist.blockUser(99);
    const token = await signAccessToken(t, { ...CLAIMS, impersonatedBy: 99 });
    expect(await t.blocklist.isBlocked(99, iatOf(t.jwt, token))).toBe(false);
  });

  it('with no block, or a Redis read failure, the iat is the current second', async () => {
    const t = build();
    const second = Math.floor(NOW.getTime() / 1000);
    expect(iatOf(t.jwt, await signAccessToken(t, CLAIMS))).toBe(second);
    t.redis.get.mockRejectedValueOnce(new Error('down'));
    expect(iatOf(t.jwt, await signAccessToken(t, CLAIMS))).toBe(second);
  });
});

describe('ROK-1810 issuedAtFor', () => {
  it('keeps the current second when the block floor is in the past', () => {
    const nowMs = NOW.getTime();
    const second = Math.floor(nowMs / 1000);
    expect(issuedAtFor(second - 60, nowMs)).toBe(second);
    expect(issuedAtFor(second + 1, nowMs)).toBe(second + 1);
    expect(issuedAtFor(undefined, nowMs)).toBe(second);
  });
});

describe('ROK-1810 Codex r2 — a second block in the same second', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('revokes the token minted after the first block; a later mint survives', async () => {
    const t = build();
    await t.blocklist.blockUser(CLAIMS.sub);
    const between = iatOf(t.jwt, await signAccessToken(t, CLAIMS));
    await t.blocklist.blockUser(CLAIMS.sub);
    expect(await t.blocklist.isBlocked(CLAIMS.sub, between)).toBe(true);
    const after = iatOf(t.jwt, await signAccessToken(t, CLAIMS));
    expect(await t.blocklist.isBlocked(CLAIMS.sub, after)).toBe(false);
  });
});

describe('ROK-1810 Codex r3 — impersonation vs a same-second block of either id', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  const IMP = { ...CLAIMS, impersonatedBy: 99 };

  it('target blocked, raised impersonation token, admin blocked same second → revoked', async () => {
    const t = build();
    await t.blocklist.blockUser(CLAIMS.sub);
    const iat = iatOf(t.jwt, await signAccessToken(t, IMP));
    expect(await t.blocklist.isBlocked(CLAIMS.sub, iat)).toBe(false);
    await t.blocklist.blockUser(99);
    expect({ adminBlockCovers: await t.blocklist.isBlocked(99, iat) }).toEqual({
      adminBlockCovers: true,
    });
  });

  it('a token minted after both blocks survives both checks', async () => {
    const t = build();
    await t.blocklist.blockUser(CLAIMS.sub);
    await t.blocklist.blockUser(99);
    const iat = iatOf(t.jwt, await signAccessToken(t, IMP));
    expect(await t.blocklist.isBlocked(CLAIMS.sub, iat)).toBe(false);
    expect(await t.blocklist.isBlocked(99, iat)).toBe(false);
  });
});
