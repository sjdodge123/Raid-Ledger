import type {
  InstancesRepository,
  RevokeOutcome,
} from '../../instances/instances.repository';
import type { RepoRunner } from '../cli-db';
import { main } from '../hub-admin';

const A = '3f2b8c1e-9a4d-4e7b-8c2f-1a6d5e9b0c47';
const REASON = 'leaked token in a public paste';

function harness(outcome: RevokeOutcome = 'revoked') {
  const out: string[] = [];
  const err: string[] = [];
  const revoke = jest.fn().mockResolvedValue(outcome);
  const runner: RepoRunner = (_env, fn) =>
    fn({ revoke } as unknown as InstancesRepository);
  const io = {
    env: {},
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
  };
  const run = (...argv: string[]) => main(['revoke', ...argv], io, runner);
  return { out, err, revoke, run };
}

describe('hub-admin revoke (ROK-1672)', () => {
  it('revokes with a reason: exit 0, one line naming only the id', async () => {
    const h = harness();
    expect(await h.run(A, '--reason', REASON)).toBe(0);
    expect(h.revoke).toHaveBeenCalledWith(A, REASON);
    expect(h.out).toEqual([`Instance ${A} revoked.`]);
    expect([...h.out, ...h.err].join('\n')).not.toContain(REASON);
  });

  it('an already revoked instance is a no-op: exit 0', async () => {
    const h = harness('already_revoked');
    expect(await h.run(A, '--reason', REASON)).toBe(0);
    expect(h.out).toEqual([
      `Instance ${A} is already revoked; nothing changed.`,
    ]);
  });

  it('an unknown id exits 1', async () => {
    const h = harness('not_found');
    expect(await h.run(A, '--reason', REASON)).toBe(1);
    expect(h.err).toEqual([`Instance ${A} is not a registered instance.`]);
  });

  it.each([
    ['no reason flag', [A]],
    ['an empty reason', [A, '--reason', '  ']],
    ['a flag without a value', [A, '--reason']],
    ['no id', ['--reason', REASON]],
  ])('%s is a usage error: exit 2, no DB call', async (_l, argv) => {
    const h = harness();
    expect(await h.run(...argv)).toBe(2);
    expect(h.revoke).not.toHaveBeenCalled();
    expect(h.err.join('\n')).toContain('--reason');
  });

  it('a non-UUID id exits 1 without a DB call', async () => {
    const h = harness();
    expect(await h.run('nope', '--reason', REASON)).toBe(1);
    expect(h.revoke).not.toHaveBeenCalled();
  });
});
