import { HubRegisterResponseSchema } from '@raid-ledger/contract';
import { HubHttpException } from '../common/hub-errors';
import type { HubInstanceRow } from '../drizzle/schema';
import type { InstancesRepository } from './instances.repository';
import { InstancesService } from './instances.service';
import { hashToken } from './tokens';

const ID = '3f2b8c1e-9a4d-4e7b-8c2f-1a6d5e9b0c47';
const EPOCH = '2026-11-25T00:00:00Z';

function row(over: Partial<HubInstanceRow> = {}): HubInstanceRow {
  return {
    instanceId: ID,
    tokenHash: 'h',
    status: 'pending',
    trustTier: 'reader',
    version: '0.0.1',
    schemaVersion: 1,
    registeredAt: new Date(0),
    approvedAt: null,
    lastHeartbeatAt: null,
    revokedAt: null,
    revokeReason: null,
    ...over,
  };
}

function setup(existing?: HubInstanceRow, upserted?: HubInstanceRow | null) {
  const repo = {
    findById: jest.fn().mockResolvedValue(existing),
    upsertPending: jest
      .fn()
      .mockImplementation((input: { tokenHash: string }) =>
        Promise.resolve(
          upserted === null ? undefined : row({ tokenHash: input.tokenHash }),
        ),
      ),
  };
  const epoch = { current: jest.fn().mockResolvedValue(EPOCH) };
  const service = new InstancesService(
    repo as unknown as InstancesRepository,
    epoch,
  );
  return { repo, epoch, service };
}

async function rejection(p: Promise<unknown>): Promise<HubHttpException> {
  const err: unknown = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (err instanceof HubHttpException) return err;
  throw new Error('expected a HubHttpException');
}

const body = { instanceId: ID, version: '0.0.1', schemaVersion: 1 };

describe('InstancesService.register (ROK-1671)', () => {
  it('mints a token, stores only its hash as pending, answers trustTier reader', async () => {
    const { repo, service } = setup();
    const res = await service.register(body);
    expect(HubRegisterResponseSchema.parse(res)).toEqual(res);
    expect(res).toMatchObject({ instanceId: ID, trustTier: 'reader' });
    expect(res).toMatchObject({ schemaVersion: 1, epoch: EPOCH });
    expect(repo.upsertPending).toHaveBeenCalledWith({
      instanceId: ID,
      tokenHash: hashToken(res.token),
      version: '0.0.1',
      schemaVersion: 1,
    });
    expect(JSON.stringify(repo.upsertPending.mock.calls)).not.toContain(
      res.token,
    );
  });

  it('answers reader again for an approved instance re-registering (L3)', async () => {
    const { service } = setup(row({ status: 'approved' }));
    expect((await service.register(body)).trustTier).toBe('reader');
  });

  it('refuses a revoked instance with 403 revoked and writes nothing (L4)', async () => {
    const { repo, service } = setup(row({ status: 'revoked' }));
    const err = await rejection(service.register(body));
    expect(err.getStatus()).toBe(403);
    expect(err.body).toEqual({ error: 'revoked' });
    expect(repo.upsertPending).not.toHaveBeenCalled();
  });

  it('refuses when the upsert was blocked by a concurrent revoke', async () => {
    const { service } = setup(undefined, null);
    expect((await rejection(service.register(body))).body).toEqual({
      error: 'revoked',
    });
  });

  it('refuses schemaVersion 2 with 426 schema_unsupported (L8)', async () => {
    const { repo, service } = setup();
    const err = await rejection(
      service.register({ ...body, schemaVersion: 2 }),
    );
    expect(err.getStatus()).toBe(426);
    expect(err.body.error).toBe('schema_unsupported');
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('answers 503 before writing when the epoch is unknown', async () => {
    const { repo, epoch, service } = setup();
    epoch.current.mockResolvedValue(undefined);
    expect((await rejection(service.register(body))).getStatus()).toBe(503);
    expect(repo.upsertPending).not.toHaveBeenCalled();
  });

  it('ignores an enrollmentCode (L2)', async () => {
    const { repo, service } = setup();
    await service.register({ ...body, enrollmentCode: 'x'.repeat(20) });
    expect(JSON.stringify(repo.upsertPending.mock.calls)).not.toContain('xxxx');
  });
});
