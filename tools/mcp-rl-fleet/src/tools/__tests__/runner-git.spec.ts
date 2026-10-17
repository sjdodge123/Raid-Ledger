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
  it('prefers the slot whose claimed_by matches the agentId', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 1, claimed_by: 'other' }, { slot: 4, claimed_by: 'me' }] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'me')).toBe(4);
  });

  it('falls back to the first claimed slot when no exact match', async () => {
    execFileOk(JSON.stringify({ slots: [{ slot: 2, claimed_by: 'someone' }, { slot: 3, claimed_by: null }] }));
    expect(await resolveSlot('rl-agent', 'rl-infra', 'nomatch')).toBe(2);
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
