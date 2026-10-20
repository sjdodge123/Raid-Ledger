/**
 * ROK-1823 U4 (D5b/D6): the `/auth/refresh` access token is minted from ONE
 * snapshot (`refresh_tokens ⋈ users`) — a revoked/missing row signs nothing,
 * the own token carries the snapshot's role + version, and an impersonation
 * token's `itv` is the snapshot version, never a later read. Drives the real
 * ImpersonationSessionService and JwtService over a queued db fake.
 */
import { JwtService } from '@nestjs/jwt';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { ImpersonationSessionService } from '../impersonation/impersonation-session.service';
import { mintRefreshAccessToken } from './refresh-access-token.helpers';

const NOW = new Date('2026-10-16T12:00:00.250Z');
const HOLDER = { id: 7, username: 'admin', role: 'admin' as const };
const TARGET = { id: 8, username: 'target', role: 'member' as const };
const ROTATED = { userId: HOLDER.id, familyId: 'fam-1', rawToken: 'raw-child' };

interface Decoded {
  sub: number;
  role: string;
  tv?: number;
  itv?: number;
  impersonatedBy?: number;
}

/** A db fake whose successive `.limit()` reads resolve the queued rows. */
function queuedDb(...reads: unknown[][]) {
  const limit = jest.fn(() => Promise.resolve(reads.shift() ?? []));
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit,
  };
  return { db: chain as unknown as PostgresJsDatabase<typeof schema>, limit };
}

function build(...reads: unknown[][]) {
  const { db, limit } = queuedDb(...reads);
  const jwt = new JwtService({ secret: 'test-secret' });
  const sign = jest.spyOn(jwt, 'sign');
  const impersonation = new ImpersonationSessionService(db);
  const resolve = jest.spyOn(impersonation, 'resolveForRefresh');
  return { deps: { db, jwt, impersonation }, jwt, sign, limit, resolve };
}

const snapshot = (tokenVersion: number, revokedAt: Date | null = null) => [
  { revokedAt, ...HOLDER, tokenVersion },
];
const marker = (expiresAt: Date) => [
  {
    familyId: ROTATED.familyId,
    impersonatorUserId: HOLDER.id,
    targetUserId: TARGET.id,
    expiresAt,
  },
];
const userRow = (u: typeof HOLDER | typeof TARGET, tokenVersion: number) => [
  { ...u, bannedAt: null, kickedAt: null, tokenVersion },
];

async function mintDecoded(t: ReturnType<typeof build>): Promise<Decoded> {
  const token = await mintRefreshAccessToken(t.deps, ROTATED);
  if (token === null) throw new Error('expected a token, got null (401)');
  return t.jwt.decode<Decoded>(token);
}

describe('ROK-1823 U4 refresh mint — snapshot gate', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('rotated row revoked → null (401), nothing signed, no marker read', async () => {
    const t = build(snapshot(4, new Date(NOW.getTime() - 1)));
    expect(await mintRefreshAccessToken(t.deps, ROTATED)).toBeNull();
    expect(t.sign).not.toHaveBeenCalled();
    expect(t.resolve).not.toHaveBeenCalled();
  });

  it('rotated row missing → null (401), nothing signed', async () => {
    const t = build([]);
    expect(await mintRefreshAccessToken(t.deps, ROTATED)).toBeNull();
    expect(t.sign).not.toHaveBeenCalled();
  });

  it('own token: the snapshot role and version, from that one read', async () => {
    const t = build(snapshot(4), []);
    const payload = await mintDecoded(t);
    expect(payload).toMatchObject({ sub: HOLDER.id, role: 'admin', tv: 4 });
    expect(payload).not.toHaveProperty('itv');
    // snapshot + marker lookup only — the holder is never re-read.
    expect(t.limit).toHaveBeenCalledTimes(2);
  });
});

describe('ROK-1823 U4 refresh mint — impersonation versions (D6)', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('tv = target version; itv = the SNAPSHOT version even when the impersonator reload is higher', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * 60 * 1000);
    const t = build(
      snapshot(4),
      marker(expiresAt),
      userRow(HOLDER, 9),
      userRow(TARGET, 2),
    );
    const payload = await mintDecoded(t);
    expect(payload).toMatchObject({
      sub: TARGET.id,
      impersonatedBy: HOLDER.id,
      tv: 2,
      itv: 4,
    });
  });

  it('marker deadline inside the current second → the holder OWN token (snapshot version)', async () => {
    const expiresAt = new Date(NOW.getTime() + 500);
    const t = build(
      snapshot(4),
      marker(expiresAt),
      userRow(HOLDER, 4),
      userRow(TARGET, 2),
    );
    const payload = await mintDecoded(t);
    expect(payload).toMatchObject({ sub: HOLDER.id, tv: 4 });
    expect(payload).not.toHaveProperty('impersonatedBy');
    expect(payload).not.toHaveProperty('itv');
  });
});
