/**
 * ROK-1956 L2 — U-10: `rlcd_` bearer → the C2 device guard, `via:'device'`;
 * anything else → the session JWT path; every refusal → the companion 401
 * body; the device path never sets `req.user`.
 */
import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { CompanionIngestErrorSchema } from '@raid-ledger/contract';
import { CompanionDeviceGuard } from '../devices/companion-device.guard';
import { CompanionDeviceRateLimiter } from '../devices/companion-device-link.limits';
import { companionDeviceTokens } from '../devices/companion-device-token.helpers';
import type { CompanionDevicesRepository } from '../devices/companion-devices.repository';
import { CompanionIngestAuthGuard } from './companion-ingest-auth.guard';
import type { CompanionIngestRequest } from './companion-ingest-request';

const TOKEN = companionDeviceTokens.generate();
const HASH = companionDeviceTokens.hash(TOKEN);
const ROW = {
  deviceId: 5,
  tokenHash: HASH,
  userId: 9,
  revokedAt: null,
  deactivatedAt: null,
  bannedAt: null,
  kickedAt: null,
};
const SESSION_USER = { id: 42, deactivatedAt: null, impersonatedBy: null };

type Req = CompanionIngestRequest & { user?: unknown };

function setup(session: CanActivate['canActivate'], row: object | null = ROW) {
  const repo = {
    findByHash: jest.fn().mockResolvedValue(row),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
  };
  const device = new CompanionDeviceGuard(
    repo as unknown as CompanionDevicesRepository,
    new CompanionDeviceRateLimiter(),
  );
  const sessionGuard = { canActivate: jest.fn(session) };
  const guard = new CompanionIngestAuthGuard(device, sessionGuard);
  return { guard, repo, sessionGuard };
}

function ctxFor(authorization?: string) {
  const req = {
    ip: '203.0.113.9',
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as Req;
  const res = { setHeader: jest.fn() };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { req, ctx };
}

/** A session guard that signs `user` in, as passport does. */
function signsIn(user: unknown): CanActivate['canActivate'] {
  return (ctx: ExecutionContext) => {
    Object.assign(ctx.switchToHttp().getRequest<object>(), { user });
    return Promise.resolve(true);
  };
}

const refuses = (err: Error) => (): Promise<boolean> => Promise.reject(err);

async function expectCompanion401(p: Promise<unknown>): Promise<void> {
  const err: unknown = await p.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof HttpException))
    throw new Error(`no HttpException: ${String(err)}`);
  expect(err.getStatus()).toBe(401);
  const body = CompanionIngestErrorSchema.parse(err.getResponse());
  expect(body.code).toBe('unauthorized');
}

describe('CompanionIngestAuthGuard (ROK-1956 D-17, U-10)', () => {
  it('an rlcd_ bearer takes the device path and never sets req.user', async () => {
    const { guard, sessionGuard } = setup(signsIn(SESSION_USER));
    const { req, ctx } = ctxFor(`Bearer ${TOKEN}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.companionIngest).toEqual({
      userId: 9,
      via: 'device',
      deviceId: 5,
      tokenHash: HASH,
    });
    expect(req.user).toBeUndefined();
    expect(sessionGuard.canActivate).not.toHaveBeenCalled();
  });

  it('an unknown rlcd_ token is the companion 401 and never falls back to a session', async () => {
    const { guard, sessionGuard } = setup(signsIn(SESSION_USER), null);
    const { req, ctx } = ctxFor(`Bearer ${companionDeviceTokens.generate()}`);
    await expectCompanion401(guard.canActivate(ctx));
    expect(sessionGuard.canActivate).not.toHaveBeenCalled();
    expect(req.companionIngest).toBeUndefined();
  });

  it('a session JWT takes the session path (no device lookup)', async () => {
    const { guard, repo } = setup(signsIn(SESSION_USER));
    const { req, ctx } = ctxFor('Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.companionIngest).toEqual({
      userId: 42,
      via: 'session',
      deviceId: null,
      tokenHash: null,
    });
    expect(repo.findByHash).not.toHaveBeenCalled();
  });

  it.each([
    ['no header', undefined],
    ['garbage', 'Bearer not-a-token'],
    ['an rlvl_ Valheim token', `Bearer rlvl_${'a'.repeat(43)}`],
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
  ])('%s → the companion 401 (passport refusal remapped)', async (_n, auth) => {
    const { guard, repo } = setup(refuses(new UnauthorizedException()));
    const { req, ctx } = ctxFor(auth);
    await expectCompanion401(guard.canActivate(ctx));
    expect(repo.findByHash).not.toHaveBeenCalled();
    expect(req.companionIngest).toBeUndefined();
  });

  it.each([
    ['a 403 from the strategy', refuses(new ForbiddenException('banned'))],
    ['a guard that answers false', () => Promise.resolve(false)],
    ['no user attached', signsIn(undefined)],
    [
      'a deactivated user',
      signsIn({ ...SESSION_USER, deactivatedAt: new Date() }),
    ],
    [
      'an impersonation session',
      signsIn({ ...SESSION_USER, impersonatedBy: 1 }),
    ],
  ])('%s → the companion 401', async (_n, session) => {
    const { guard } = setup(session);
    await expectCompanion401(guard.canActivate(ctxFor('Bearer x.y.z').ctx));
  });

  it('a non-HTTP failure on the session path is rethrown (500, not a 401)', async () => {
    const boom = new Error('db down');
    const { guard } = setup(refuses(boom));
    await expect(guard.canActivate(ctxFor('Bearer x.y.z').ctx)).rejects.toBe(
      boom,
    );
  });
});
