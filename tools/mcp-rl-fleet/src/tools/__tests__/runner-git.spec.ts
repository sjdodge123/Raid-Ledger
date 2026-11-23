// ROK-1362 — resolveSlot extracted from validate-ci into runner-git. Mocks the
// child_process boundary (no real SSH).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execFileSync: (...args: unknown[]) => mockExecFile(...args),
  default: {
    execFile: (...args: unknown[]) => mockExecFile(...args),
    execFileSync: (...args: unknown[]) => mockExecFile(...args),
  },
}));

import { resolveSlot, ensureRunnerGit, RL_STATUS_CMD } from '../runner-git.js';

function execFileOk(stdout: string): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, o: string, s: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, stdout, '');
    },
  );
}
function execFileFail(): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, o: string, s: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(Object.assign(new Error('ssh down'), { code: 255 }), '', 'ssh down');
    },
  );
}

beforeEach(() => mockExecFile.mockReset());

describe('resolveSlot', () => {
  // ROK-2205: the real `rl status --json` shape (claimed + agent_id, no claimed_by).
  // Matching only claimed_by returned null for every live claim, so the gate's
  // sync check could never verify and no sentinel could be written.
  it('matches the live status shape: agent_id + claimed', async () => {
    execFileOk(JSON.stringify({ slots: [
      { slot: 1, claimed: true, agent_id: 'other' },
      { slot: 2, claimed: true, agent_id: 'me' },
      { slot: 3, claimed: false, agent_id: null },
    ] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'me', { exact: true })).toBe(2);
  });

  it('live shape: falls back to a claimed slot, never an unclaimed one', async () => {
    execFileOk(JSON.stringify({ slots: [
      { slot: 1, claimed: false, agent_id: null },
      { slot: 2, claimed: true, agent_id: 'someone' },
    ] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'nomatch')).toBe(2);
  });

  it('live shape: null when every slot is free', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 1, claimed: false, agent_id: null }] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'me')).toBeNull();
  });

  it('prefers the slot whose claimed_by matches the agentId', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 1, claimed_by: 'other' }, { slot: 4, claimed_by: 'me' }] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'me')).toBe(4);
  });

  it('falls back to the first claimed slot when no exact match', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 2, claimed_by: 'someone' }, { slot: 3, claimed_by: null }] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'nomatch')).toBe(2);
  });

  it('exact mode (parallel gate): no fallback to another agent\'s claimed slot', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 2, claimed_by: 'someone' }, { slot: 3, claimed_by: null }] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'nomatch', { exact: true })).toBeNull();
  });

  it('exact mode still returns the caller\'s own slot', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 1, claimed_by: 'other' }, { slot: 4, claimed_by: 'me' }] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'me', { exact: true })).toBe(4);
  });

  it('returns null when nothing is claimed', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 1, claimed_by: null }] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'me')).toBeNull();
  });

  it('runs the VM status script that exists (orchestrator/bin/status, not bin/rl)', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 1, claimed: true, agent_id: 'me' }] }));
    await resolveSlot('rl-agent', 'rl-infra', 'me');
    const args = mockExecFile.mock.calls[0]?.[1] as string[] | undefined;
    expect(args?.at(-1)).toBe('/srv/rl-infra/orchestrator/bin/status');
    expect(RL_STATUS_CMD).toBe('/srv/rl-infra/orchestrator/bin/status');
  });

  it('returns null on SSH failure (swallowed)', async () => {
    execFileFail();
    expect(await resolveSlot('rl-agent', 'rl-infra', 'me')).toBeNull();
  });
});

describe('ensureRunnerGit', () => {
  // ROK-2205 r3 m1: with resolveSlot live, the non-exact fallback handed an
  // unclaimed caller another agent's slot, and the re-scaffold ran there.
  it('never probes or re-scaffolds another agent\'s runner when the caller holds no claim', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: (e: Error | null, o: string, s: string) => void) => {
        const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
        const argv = Array.isArray(args) ? args.join(' ') : '';
        const out = argv.includes(RL_STATUS_CMD)
          ? JSON.stringify({ slots: [{ slot: 2, claimed: true, agent_id: 'someone-else' }] })
          : '';
        if (callback) callback(null, out, '');
        return out; // execFileSync shares this mock
      },
    );
    await ensureRunnerGit('rl-agent', 'rl-infra', 'me', undefined);
    const argvs = mockExecFile.mock.calls.map((c) => (Array.isArray(c[1]) ? (c[1] as string[]).join(' ') : ''));
    expect(argvs.some((a) => a.includes('rl-runner-2')), JSON.stringify(argvs)).toBe(false);
    expect(argvs.length, JSON.stringify(argvs)).toBe(1);
  });
});
