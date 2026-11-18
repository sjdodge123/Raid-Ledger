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

import { resolveSlot } from '../runner-git.js';

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

  it('returns null on SSH failure (swallowed)', async () => {
    execFileFail();
    expect(await resolveSlot('rl-agent', 'rl-infra', 'me')).toBeNull();
  });
});
