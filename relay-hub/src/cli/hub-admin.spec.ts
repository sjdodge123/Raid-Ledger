import type { HubInstanceRow } from '../drizzle/schema';
import type {
  ApproveOutcome,
  InstancesRepository,
} from '../instances/instances.repository';
import type { RepoRunner } from './cli-db';
import { main, USAGE } from './hub-admin';

const A = '3f2b8c1e-9a4d-4e7b-8c2f-1a6d5e9b0c47';

function row(over: Partial<HubInstanceRow>): HubInstanceRow {
  return {
    instanceId: A,
    tokenHash: 'deadbeef'.repeat(8),
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

function harness(rows: HubInstanceRow[] = [], outcome?: ApproveOutcome) {
  const out: string[] = [];
  const err: string[] = [];
  const repo = {
    list: jest.fn().mockResolvedValue(rows),
    approve: jest.fn().mockResolvedValue(outcome),
  };
  const runner: RepoRunner = (_env, fn) =>
    fn(repo as unknown as InstancesRepository);
  const io = {
    env: {},
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
  };
  const run = (...argv: string[]) => main(argv, io, runner);
  return { out, err, repo, run };
}

describe('hub-admin dispatcher (ROK-1671)', () => {
  it('prints usage for --help (exit 0) and an unknown command (exit 2)', async () => {
    const h = harness();
    expect(await h.run('--help')).toBe(0);
    expect(h.out).toEqual([USAGE]);
    expect(await h.run('enroll-code')).toBe(2);
    expect(await h.run()).toBe(2);
    expect(h.err).toEqual([USAGE, USAGE]);
  });

  it('instances prints one line per instance without the token hash', async () => {
    const h = harness([row({}), row({ instanceId: 'b', status: 'approved' })]);
    expect(await h.run('instances')).toBe(0);
    expect(h.out).toHaveLength(2);
    expect(h.out[0]).toBe(
      `${A}  pending  reader  v0.0.1  registered 2026-11-25T01:00:00.000Z  heartbeat never`,
    );
    expect(h.out.join('\n')).not.toContain('deadbeef');
  });

  it('instances --json prints a fixed-key-order array without the hash', async () => {
    const h = harness([row({})]);
    expect(await h.run('instances', '--json')).toBe(0);
    const parsed: unknown = JSON.parse(h.out.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(Object.keys((parsed as object[])[0] ?? {})).toEqual([
      'instanceId',
      'status',
      'trustTier',
      'version',
      'registeredAt',
      'approvedAt',
      'lastHeartbeatAt',
    ]);
    expect(h.out.join('\n')).not.toContain('deadbeef');
  });
});

describe('hub-admin approve (ROK-1671)', () => {
  it.each([
    ['approved', 0],
    ['already_approved', 0],
    ['not_found', 1],
    ['revoked', 1],
    ['disconnected', 1],
  ] as const)('approve → %s exits %i with one line', async (outcome, code) => {
    const h = harness([], outcome);
    expect(await h.run('approve', A)).toBe(code);
    expect(h.repo.approve).toHaveBeenCalledWith(A);
    expect([...h.out, ...h.err]).toHaveLength(1);
  });

  it('approve without an id exits 2 without touching the DB', async () => {
    const h = harness();
    expect(await h.run('approve')).toBe(2);
    expect(h.repo.approve).not.toHaveBeenCalled();
  });

  it('approve <non-uuid> exits 1 with one clean line and no DB call', async () => {
    const h = harness();
    expect(await h.run('approve', 'not-a-uuid')).toBe(1);
    expect(h.repo.approve).not.toHaveBeenCalled();
    expect(h.err).toEqual([
      'hub-admin approve: not-a-uuid is not an instance id (expected a UUID)',
    ]);
  });

  it('a DB failure is one error line and exit 1', async () => {
    const h = harness();
    h.repo.list.mockRejectedValue(new Error('connect ECONNREFUSED'));
    expect(await h.run('instances')).toBe(1);
    expect(h.err).toEqual(['hub-admin instances: connect ECONNREFUSED']);
  });
});
