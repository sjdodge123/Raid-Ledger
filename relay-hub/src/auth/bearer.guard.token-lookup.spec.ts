import type { ExecutionContext } from '@nestjs/common';
import type { HubInstanceRow } from '../drizzle/schema';
import type { InstancesRepository } from '../instances/instances.repository';
import { hashToken, mintToken } from '../instances/tokens';
import { HubHttpException } from '../common/hub-errors';
import { HubBearerGuard, type HubAuthedRequest } from './bearer.guard';

const A = '3f2b8c1e-9a4d-4e7b-8c2f-1a6d5e9b0c47';
const TOKEN_A = mintToken();
const INVALID = { error: 'unknown', message: 'invalid_token' };

function row(over: Partial<HubInstanceRow>): HubInstanceRow {
  return {
    instanceId: A,
    tokenHash: hashToken(TOKEN_A),
    status: 'pending',
    trustTier: 'reader',
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

/** A guard on a route with no `:id` (ROK-1674 `crosswalk/contributions`). */
function harness(rows: HubInstanceRow[], params: Record<string, string> = {}) {
  const findById = jest.fn();
  const findByTokenHash = jest.fn((hash: string) =>
    Promise.resolve(rows.find((r) => r.tokenHash === hash)),
  );
  const repo = { findById, findByTokenHash } as unknown as InstancesRepository;
  const guard = new HubBearerGuard(repo);
  const run = async (authorization: string) => {
    const req: HubAuthedRequest = { params, headers: { authorization } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { ok: await guard.canActivate(ctx), req };
  };
  return { findById, findByTokenHash, run };
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HubHttpException) return err.body;
    throw err;
  }
  throw new Error('expected a HubHttpException');
}

describe('HubBearerGuard without a path :id (ROK-1674)', () => {
  it('finds the instance by its token hash and attaches status + trust tier', async () => {
    const h = harness([row({})]);
    const { ok, req } = await h.run(`Bearer ${TOKEN_A}`);
    expect(ok).toBe(true);
    expect(req.hubInstance).toEqual({
      instanceId: A,
      tokenHash: hashToken(TOKEN_A),
      status: 'pending',
      trustTier: 'reader',
    });
    expect(h.findById).not.toHaveBeenCalled();
  });

  it('an unknown token is the generic 401', async () => {
    expect(await rejection(harness([]).run(`Bearer ${TOKEN_A}`))).toEqual(
      INVALID,
    );
  });

  it('a revoked instance answers revoked to its own token', async () => {
    const h = harness([row({ status: 'revoked' })]);
    expect(await rejection(h.run(`Bearer ${TOKEN_A}`))).toEqual({
      error: 'revoked',
    });
  });

  it('a malformed token never reaches the database', async () => {
    const h = harness([row({})]);
    expect(await rejection(h.run('Bearer rlh_short'))).toEqual(INVALID);
    expect(h.findByTokenHash).not.toHaveBeenCalled();
  });

  it('fails closed on a route whose params are not exactly :id (no hash lookup)', async () => {
    const h = harness([row({})], { instanceId: A });
    expect(await rejection(h.run(`Bearer ${TOKEN_A}`))).toEqual(INVALID);
    expect(h.findByTokenHash).not.toHaveBeenCalled();
    expect(h.findById).not.toHaveBeenCalled();
  });
});
