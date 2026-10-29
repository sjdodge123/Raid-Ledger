/**
 * ROK-1955 L4 — CompanionDeviceGuard unit behaviour (S-2, S-6, S-7): one
 * 401 for every refusal, no DB read for a malformed bearer, never `req.user`.
 */
import { HttpException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { CompanionDeviceGuard } from './companion-device.guard';
import { CompanionDeviceRateLimiter } from './companion-device-link.limits';
import { companionDeviceTokens } from './companion-device-token.helpers';
import type { CompanionDevicesRepository } from './companion-devices.repository';
import type { CompanionDeviceRequest } from './companion-device-request';

const TOKEN = companionDeviceTokens.generate();
const HASH = companionDeviceTokens.hash(TOKEN);

function setup(row: Record<string, unknown> | null = null) {
  const repo = {
    findByHash: jest.fn().mockResolvedValue(row),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
  };
  const limiter = new CompanionDeviceRateLimiter();
  const guard = new CompanionDeviceGuard(
    repo as unknown as CompanionDevicesRepository,
    limiter,
  );
  return { repo, guard };
}

function ctxFor(authorization?: string) {
  const req = {
    ip: '203.0.113.77',
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as CompanionDeviceRequest & { user?: unknown };
  const res = { setHeader: jest.fn() };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { req, res, ctx };
}

const liveRow = {
  deviceId: 7,
  userId: 3,
  tokenHash: HASH,
  revokedAt: null,
  deactivatedAt: null,
  bannedAt: null,
  kickedAt: null,
};

/** Seven days ago — past the 24 h kick cooldown. */
const LONG_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

async function bodyOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err: unknown) {
    if (err instanceof HttpException) return err.getResponse();
    throw err;
  }
  throw new Error('expected the guard to refuse');
}

const UNAUTHORIZED = { code: 'unauthorized', message: 'Invalid device token' };

describe('CompanionDeviceGuard', () => {
  it.each([
    ['no header', undefined],
    ['not Bearer', `Basic ${TOKEN}`],
    ['Bearer x', 'Bearer x'],
    ['an rlvl_ token', `Bearer rlvl_${'a'.repeat(43)}`],
    ['a JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig'],
  ])('%s → the one 401 with no DB read', async (_l, header) => {
    const { repo, guard } = setup(liveRow);
    const { ctx } = ctxFor(header);
    expect(await bodyOf(guard.canActivate(ctx))).toEqual(UNAUTHORIZED);
    expect(repo.findByHash).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown token', null],
    ['revoked device', { ...liveRow, revokedAt: new Date() }],
    ['deactivated owner', { ...liveRow, deactivatedAt: new Date() }],
    ['banned owner', { ...liveRow, bannedAt: new Date() }],
    ['owner in a kick cooldown', { ...liveRow, kickedAt: new Date() }],
    ['hash mismatch', { ...liveRow, tokenHash: 'f'.repeat(64) }],
  ])('%s → the same 401, no touch', async (_l, row) => {
    const { repo, guard } = setup(row);
    const { ctx } = ctxFor(`Bearer ${TOKEN}`);
    expect(await bodyOf(guard.canActivate(ctx))).toEqual(UNAUTHORIZED);
    expect(repo.findByHash).toHaveBeenCalledWith(HASH);
    expect(repo.touchLastUsed).not.toHaveBeenCalled();
  });

  it('a live token attaches companionDevice, never req.user, and touches', async () => {
    const { repo, guard } = setup(liveRow);
    const { req, ctx } = ctxFor(`Bearer ${TOKEN}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.companionDevice).toEqual({
      deviceId: 7,
      userId: 3,
      tokenHash: HASH,
    });
    expect(req.user).toBeUndefined();
    expect(repo.touchLastUsed).toHaveBeenCalledWith(7, '203.0.113.x');
  });

  it('an owner whose kick cooldown has expired is accepted (as for sessions)', async () => {
    const { guard } = setup({ ...liveRow, kickedAt: LONG_AGO });
    await expect(
      guard.canActivate(ctxFor(`Bearer ${TOKEN}`).ctx),
    ).resolves.toBe(true);
  });

  it('the 31st failure from one IP in a minute is 429 before any lookup', async () => {
    const { repo, guard } = setup(null);
    for (let i = 0; i < 30; i += 1) {
      await expect(
        guard.canActivate(ctxFor(`Bearer ${TOKEN}`).ctx),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    repo.findByHash.mockClear();
    const { res, ctx } = ctxFor(`Bearer ${TOKEN}`);
    const body = await bodyOf(guard.canActivate(ctx));
    expect(body).toMatchObject({ code: 'rate_limited' });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(repo.findByHash).not.toHaveBeenCalled();
  });

  it('successful auths do not spend the failure budget', async () => {
    const { guard } = setup(liveRow);
    for (let i = 0; i < 40; i += 1) {
      await expect(
        guard.canActivate(ctxFor(`Bearer ${TOKEN}`).ctx),
      ).resolves.toBe(true);
    }
  });
});
