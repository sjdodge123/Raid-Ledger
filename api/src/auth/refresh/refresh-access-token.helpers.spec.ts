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

const ROTATED = { userId: USER.id, familyId: 'fam-1', rawToken: 'raw-child' };

async function mintOrFail(
  deps: Parameters<typeof mintRefreshAccessToken>[0],
): Promise<string> {
  const token = await mintRefreshAccessToken(deps, ROTATED);
  if (token === null) throw new Error('expected a token, got null (401)');
  return token;
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
    const token = await mintOrFail(t.deps);
    const iat = iatOf(t.jwt, token);
    expect(await t.blocklist.isBlocked(USER.id, iat)).toBe(false);
  });

  it('the impersonation path clears the impersonating admin block too', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * 60 * 1000);
    const t = build({ target: TARGET, expiresAt });
    await t.blocklist.blockUser(USER.id);
    const token = await mintOrFail(t.deps);
    const iat = iatOf(t.jwt, token);
    expect(await t.blocklist.isBlocked(USER.id, iat)).toBe(false);
    expect(t.jwt.decode<{ sub: number }>(token).sub).toBe(TARGET.id);
  });

  it('with no block the iat is the current second', async () => {
    const t = build(null);
    const token = await mintOrFail(t.deps);
    expect(iatOf(t.jwt, token)).toBe(Math.floor(NOW.getTime() / 1000));
  });
});

/** A db fake whose successive `.limit()` reads resolve the queued rows. */
function queuedDb(...reads: unknown[][]) {
  const limit = jest.fn(() => Promise.resolve(reads.shift() ?? []));
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit,
  };
  return { db: chain as unknown as PostgresJsDatabase<typeof schema>, limit };
}

describe('ROK-1810 Codex r2 — refresh mint after a concurrent revoke', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('floor present + rotated row revoked → null (401), nothing signed', async () => {
    const t = build(null);
    await t.blocklist.blockUser(USER.id);
    const q = queuedDb([{ revokedAt: new Date(NOW) }], [USER]);
    const sign = jest.spyOn(t.jwt, 'sign');
    const deps = { ...t.deps, db: q.db };
    await expect(mintRefreshAccessToken(deps, ROTATED)).resolves.toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });

  it('floor present + rotated row live → a token that survives the floor', async () => {
    const t = build(null);
    await t.blocklist.blockUser(USER.id);
    const q = queuedDb([{ revokedAt: null }], [USER]);
    const token = await mintOrFail({ ...t.deps, db: q.db });
    expect(await t.blocklist.isBlocked(USER.id, iatOf(t.jwt, token))).toBe(
      false,
    );
    expect(q.limit).toHaveBeenCalledTimes(2);
  });

  it('no floor → no revoke re-check query (only the user lookup)', async () => {
    const t = build(null);
    const q = queuedDb([USER]);
    await mintOrFail({ ...t.deps, db: q.db });
    expect(q.limit).toHaveBeenCalledTimes(1);
  });
});
