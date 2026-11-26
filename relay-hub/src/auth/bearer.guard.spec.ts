import * as crypto from 'crypto';

// Node's crypto exports are non-configurable, so spy through a module mock.
jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});
import type { ExecutionContext } from '@nestjs/common';
import type { HubInstanceRow } from '../drizzle/schema';
import type { InstancesRepository } from '../instances/instances.repository';
import { hashToken, mintToken } from '../instances/tokens';
import { HubHttpException } from '../common/hub-errors';
import { HubBearerGuard, type HubAuthedRequest } from './bearer.guard';

const A = '3f2b8c1e-9a4d-4e7b-8c2f-1a6d5e9b0c47';
const B = '7c1e4d2a-8b3f-4a6e-9d5c-2f1b0a8e7d63';
const TOKEN_A = mintToken();
const TOKEN_B = mintToken();

function row(over: Partial<HubInstanceRow>): HubInstanceRow {
  return {
    instanceId: A,
    tokenHash: hashToken(TOKEN_A),
    status: 'approved',
    trustTier: 'contributor',
    version: '0.0.1',
    schemaVersion: 1,
    registeredAt: new Date('2026-11-25T01:00:00Z'),
    approvedAt: null,
    lastHeartbeatAt: null,
    revokedAt: null,
    revokeReason: null,
    ...over,
  };
}

/** A guard over an in-memory table keyed by instance id. */
function harness(rows: HubInstanceRow[]) {
  const findById = jest.fn((id: string) =>
    Promise.resolve(rows.find((r) => r.instanceId === id)),
  );
  const repo = { findById } as unknown as InstancesRepository;
  const guard = new HubBearerGuard(repo);
  const run = async (id: string, authorization?: string) => {
    const req: HubAuthedRequest = {
      params: { id },
      headers: authorization === undefined ? {} : { authorization },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { ok: await guard.canActivate(ctx), req };
  };
  return { findById, run };
}

/** Resolves to the 401 body the guard threw, or fails loudly. */
async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    if (!(err instanceof HubHttpException)) throw err;
    expect(err.getStatus()).toBe(401);
    return err.body;
  }
  throw new Error('expected the guard to reject with 401');
}

const INVALID = { error: 'unknown', message: 'invalid_token' };

afterEach(() => jest.clearAllMocks());

describe('HubBearerGuard (ROK-1672)', () => {
  it('accepts the right token and attaches the instance to the request', async () => {
    const h = harness([row({})]);
    const { ok, req } = await h.run(A, `Bearer ${TOKEN_A}`);
    expect(ok).toBe(true);
    expect(req.hubInstance).toEqual({
      instanceId: A,
      tokenHash: hashToken(TOKEN_A),
      status: 'approved',
    });
  });

  it('accepts a pending instance (L3)', async () => {
    const h = harness([row({ status: 'pending' })]);
    expect((await h.run(A, `Bearer ${TOKEN_A}`)).ok).toBe(true);
  });

  it("rejects another instance's valid token (path-id binding, L1)", async () => {
    const h = harness([
      row({}),
      row({ instanceId: B, tokenHash: hashToken(TOKEN_B) }),
    ]);
    expect(await rejection(h.run(A, `Bearer ${TOKEN_B}`))).toEqual(INVALID);
    expect(h.findById).toHaveBeenCalledWith(A);
  });
});

describe('HubBearerGuard rejections (ROK-1672)', () => {
  it.each([
    ['missing', undefined],
    ['not Bearer', `Basic ${TOKEN_A}`],
    ['no rlh_ prefix', `Bearer ${TOKEN_A.slice(4)}`],
    ['rlh_ but wrong shape', 'Bearer rlh_short'],
  ])('rejects a %s header before any DB call', async (_label, header) => {
    const h = harness([row({})]);
    expect(await rejection(h.run(A, header))).toEqual(INVALID);
    expect(h.findById).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID path id before any DB call', async () => {
    const h = harness([row({})]);
    expect(await rejection(h.run('nope', `Bearer ${TOKEN_A}`))).toEqual(
      INVALID,
    );
    expect(h.findById).not.toHaveBeenCalled();
  });

  it('rejects an unknown instance and a cleared (disconnected) token', async () => {
    expect(await rejection(harness([]).run(A, `Bearer ${TOKEN_A}`))).toEqual(
      INVALID,
    );
    const cleared = harness([row({ status: 'disconnected', tokenHash: null })]);
    expect(await rejection(cleared.run(A, `Bearer ${TOKEN_A}`))).toEqual(
      INVALID,
    );
  });

  it("answers revoked only to the holder of the revoked instance's token (L2)", async () => {
    const h = harness([row({ status: 'revoked' })]);
    expect(await rejection(h.run(A, `Bearer ${TOKEN_A}`))).toEqual({
      error: 'revoked',
    });
    expect(await rejection(h.run(A, `Bearer ${TOKEN_B}`))).toEqual(INVALID);
  });

  it('compares hashes with crypto.timingSafeEqual', async () => {
    const spy = jest.mocked(crypto.timingSafeEqual);
    await harness([row({})]).run(A, `Bearer ${TOKEN_A}`);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a stored hash of another length is a 401, not a throw', async () => {
    const spy = jest.mocked(crypto.timingSafeEqual);
    const h = harness([row({ tokenHash: 'abcd' })]);
    expect(await rejection(h.run(A, `Bearer ${TOKEN_A}`))).toEqual(INVALID);
    expect(spy).not.toHaveBeenCalled();
  });
});
