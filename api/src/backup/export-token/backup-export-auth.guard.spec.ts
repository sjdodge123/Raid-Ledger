/**
 * ROK-2263 L3 — `BackupExportAuthGuard` unit matrix: malformed `rlbx_` → 401
 * with no DB read; unknown / mismatched / revoked / expired / non-admin /
 * deactivated / banned / kick-cooling owner → the SAME 401; a valid token
 * sets `req.backupExport` (never `req.user`), stamps last-used and logs one
 * secret-free line; every other header takes the JWT + admin path.
 */
import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { BackupExportAuthGuard } from './backup-export-auth.guard';
import type { BackupExportRequest } from './backup-export-request';
import { backupExportTokenKit } from './backup-export-token.helpers';
import type {
  BackupExportTokenAuthRow,
  BackupExportTokensRepository,
} from './backup-export-tokens.repository';

const TOKEN = backupExportTokenKit.generate();
const HASH = backupExportTokenKit.hash(TOKEN);
const HOUR_MS = 60 * 60 * 1000;
const ROW: BackupExportTokenAuthRow = {
  tokenId: 7,
  ownerUserId: 3,
  tokenHash: HASH,
  revokedAt: null,
  expiresAt: null,
  role: 'admin',
  deactivatedAt: null,
  bannedAt: null,
  kickedAt: null,
};

type Req = BackupExportRequest & { user?: unknown };

function setup(
  row: BackupExportTokenAuthRow | null = ROW,
  session: CanActivate['canActivate'] = () => true,
) {
  const repo = {
    findAuthByHash: jest.fn().mockResolvedValue(row),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
  };
  const sessionGuard = { canActivate: jest.fn(session) };
  const guard = new BackupExportAuthGuard(
    repo as unknown as BackupExportTokensRepository,
    sessionGuard,
  );
  return { guard, repo, sessionGuard };
}

function ctxFor(authorization?: string) {
  const req = {
    ip: '203.0.113.9',
    method: 'GET',
    path: '/admin/backups',
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as Req;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { req, ctx };
}

/** The 401 the guard threw, so refusals can be compared byte for byte. */
async function refusalOf(
  guard: BackupExportAuthGuard,
  ctx: ExecutionContext,
): Promise<unknown> {
  const err: unknown = await guard.canActivate(ctx).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(UnauthorizedException);
  return err instanceof UnauthorizedException ? err.getResponse() : null;
}

afterEach(() => jest.restoreAllMocks());

describe('token path refusals', () => {
  it('401s a malformed rlbx_ bearer without reading the DB', async () => {
    const { guard, repo, sessionGuard } = setup();
    for (const bad of [
      'Bearer rlbx_short',
      `Bearer ${TOKEN}x`,
      'Bearer rlbx_',
    ]) {
      await refusalOf(guard, ctxFor(bad).ctx);
    }
    expect(repo.findAuthByHash).not.toHaveBeenCalled();
    expect(sessionGuard.canActivate).not.toHaveBeenCalled();
  });

  const past = new Date(Date.now() - HOUR_MS);
  const cases: Array<[string, BackupExportTokenAuthRow | null]> = [
    ['unknown token', null],
    ['hash mismatch', { ...ROW, tokenHash: 'f'.repeat(64) }],
    ['revoked', { ...ROW, revokedAt: past }],
    ['expired', { ...ROW, expiresAt: past }],
    ['owner demoted to member', { ...ROW, role: 'member' }],
    ['owner demoted to operator', { ...ROW, role: 'operator' }],
    ['owner deactivated', { ...ROW, deactivatedAt: past }],
    ['owner banned', { ...ROW, bannedAt: past }],
    ['owner kick-cooling-down', { ...ROW, kickedAt: new Date() }],
  ];

  it.each(cases)(
    '%s → the same 401, no stamp, no req fields',
    async (_n, row) => {
      const baseline = await refusalOf(
        setup(null).guard,
        ctxFor(`Bearer ${TOKEN}`).ctx,
      );
      const { guard, repo } = setup(row);
      const { req, ctx } = ctxFor(`Bearer ${TOKEN}`);
      expect(await refusalOf(guard, ctx)).toEqual(baseline);
      expect(repo.findAuthByHash).toHaveBeenCalledWith(HASH);
      expect(repo.touchLastUsed).not.toHaveBeenCalled();
      expect(req.backupExport).toBeUndefined();
      expect(req.user).toBeUndefined();
    },
  );
});

describe('token path acceptance', () => {
  it('sets req.backupExport, never req.user, stamps and logs without secrets', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { guard, repo, sessionGuard } = setup();
    const { req, ctx } = ctxFor(`Bearer ${TOKEN}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.backupExport).toEqual({ tokenId: 7, ownerUserId: 3 });
    expect(req.user).toBeUndefined();
    expect(sessionGuard.canActivate).not.toHaveBeenCalled();
    expect(repo.touchLastUsed).toHaveBeenCalledWith(7, '203.0.113.x');
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toBe('backup-export token #7 (owner 3) GET /admin/backups');
    for (const secret of [TOKEN, HASH, backupExportTokenKit.hintOf(TOKEN)]) {
      expect(line).not.toContain(secret);
    }
  });

  it('accepts a future expiry and a long-expired kick', async () => {
    const row = {
      ...ROW,
      expiresAt: new Date(Date.now() + HOUR_MS),
      kickedAt: new Date(Date.now() - 365 * 24 * HOUR_MS),
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { guard } = setup(row);
    await expect(
      guard.canActivate(ctxFor(`Bearer ${TOKEN}`).ctx),
    ).resolves.toBe(true);
  });
});

describe('session path (unchanged behaviour)', () => {
  function withUser(role: string): CanActivate['canActivate'] {
    return (ctx) => {
      const req = ctx.switchToHttp().getRequest<Req>();
      req.user = { id: 1, username: 'u', role };
      return true;
    };
  }

  it('an admin JWT passes; the repo is never read', async () => {
    const { guard, repo } = setup(ROW, withUser('admin'));
    const { req, ctx } = ctxFor('Bearer some.jwt.value');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.findAuthByHash).not.toHaveBeenCalled();
    expect(req.backupExport).toBeUndefined();
  });

  it('a member JWT → 403 Admin access required', async () => {
    const { guard } = setup(ROW, withUser('member'));
    await expect(guard.canActivate(ctxFor('Bearer a.b.c').ctx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('a failing JWT (or no header) → the strategy 401 propagates', async () => {
    const { guard, sessionGuard } = setup(ROW, () => {
      throw new UnauthorizedException();
    });
    await expect(guard.canActivate(ctxFor().ctx)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(ctxFor('Bearer rlcd_x').ctx),
    ).rejects.toThrow(UnauthorizedException);
    expect(sessionGuard.canActivate).toHaveBeenCalledTimes(2);
  });

  it('a session guard that answers false is refused (no admin check passes)', async () => {
    const { guard } = setup(ROW, () => false);
    await expect(guard.canActivate(ctxFor('Bearer a.b.c').ctx)).resolves.toBe(
      false,
    );
  });
});

describe('ROK-2263 Codex P2: the auth scheme is case-insensitive (RFC 7235)', () => {
  it.each(['bearer', 'BEARER', 'BeArEr'])(
    '%s + a valid rlbx_ token takes the token path',
    async (scheme) => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const { guard, repo, sessionGuard } = setup();
      const { req, ctx } = ctxFor(`${scheme} ${TOKEN}`);
      const out: unknown = await guard
        .canActivate(ctx)
        .catch((e: unknown) => e);
      expect(sessionGuard.canActivate).not.toHaveBeenCalled();
      expect(out).toBe(true);
      expect(repo.findAuthByHash).toHaveBeenCalledWith(HASH);
      expect(req.backupExport?.tokenId).toBe(7);
    },
  );

  it.each(['bearer rlbx_short', `BEARER ${TOKEN}x`, 'bearer rlbx_'])(
    '401s the malformed %s without reading the DB',
    async (header) => {
      const { guard, repo, sessionGuard } = setup();
      const err: unknown = await guard.canActivate(ctxFor(header).ctx).then(
        () => null,
        (e: unknown) => e,
      );
      expect(sessionGuard.canActivate).not.toHaveBeenCalled();
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(repo.findAuthByHash).not.toHaveBeenCalled();
    },
  );

  it.each([
    'bearer a.b.c',
    'BEARER some.jwt.value',
    'bearer rlcd_x',
    'Bearer RLBX_x',
  ])('a non-rlbx_ bearer (%s) still takes the JWT path', async (header) => {
    const { guard, repo, sessionGuard } = setup(ROW, () => false);
    await expect(guard.canActivate(ctxFor(header).ctx)).resolves.toBe(false);
    expect(sessionGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(repo.findAuthByHash).not.toHaveBeenCalled();
  });
});
