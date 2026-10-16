/**
 * ROK-1810 Codex P2: the access token `/auth/refresh` mints in the same second
 * as a `blockUser` (a sibling tab refreshing right after a password change)
 * must not be born revoked. Drives the real TokenBlocklistService over an
 * in-memory Redis and the real JwtService.
 */
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  TokenBlocklistService,
  nextBlockStamp,
} from '../token-blocklist.service';
import { mintRefreshAccessToken } from './refresh-access-token.helpers';

const NOW = new Date('2026-10-16T12:00:00.250Z');
const USER = { id: 7, username: 'admin', role: 'admin' as const };
const TARGET = { id: 8, username: 'target', role: 'member' as const };

function dbReturning(rows: unknown[]): PostgresJsDatabase<typeof schema> {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain as unknown as PostgresJsDatabase<typeof schema>;
}

function build(live: { target: typeof TARGET; expiresAt: Date } | null) {
  const store = new Map<string, string>();
  const redis = {
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    eval: jest.fn((_s: string, _n: number, key: string, now: string) => {
      const stamp = nextBlockStamp(store.get(key) ?? null, Number(now));
      store.set(key, String(stamp));
      return Promise.resolve(stamp);
    }),
  };
  const blocklist = new TokenBlocklistService(redis as unknown as Redis);
  const jwt = new JwtService({ secret: 'test-secret' });
  const impersonation = {
    resolveForRefresh: jest.fn().mockResolvedValue(live),
  };
  const deps = { db: dbReturning([USER]), jwt, blocklist, impersonation };
  return { deps, blocklist, jwt };
}

function iatOf(jwt: JwtService, token: string): number {
  return jwt.decode<{ iat: number }>(token).iat;
}

describe('ROK-1810 mintRefreshAccessToken — same-second mint after a block', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('the own-token path minted in the block second is NOT rejected by isBlocked', async () => {
    const t = build(null);
    await t.blocklist.blockUser(USER.id);
    const token = await mintRefreshAccessToken(t.deps, {
      userId: USER.id,
      familyId: 'fam-1',
    });
    const iat = iatOf(t.jwt, token);
    expect(await t.blocklist.isBlocked(USER.id, iat)).toBe(false);
  });

  it('the impersonation path clears the impersonating admin block too', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * 60 * 1000);
    const t = build({ target: TARGET, expiresAt });
    await t.blocklist.blockUser(USER.id);
    const token = await mintRefreshAccessToken(t.deps, {
      userId: USER.id,
      familyId: 'fam-1',
    });
    const iat = iatOf(t.jwt, token);
    expect(await t.blocklist.isBlocked(USER.id, iat)).toBe(false);
    expect(t.jwt.decode<{ sub: number }>(token).sub).toBe(TARGET.id);
  });

  it('with no block the iat is the current second', async () => {
    const t = build(null);
    const token = await mintRefreshAccessToken(t.deps, {
      userId: USER.id,
      familyId: 'fam-1',
    });
    expect(iatOf(t.jwt, token)).toBe(Math.floor(NOW.getTime() / 1000));
  });
});
