// TDB:698 — worktreePathSchema must surface validateWorktreePath's per-value
// message under zod 4. The zod-3 `.refine(fn, (val) => ({ message }))` form is
// silently ignored by zod 4, which reports a bare "Invalid input" instead.
import { describe, it, expect } from 'vitest';
import { validateWorktreePath, worktreePathSchema } from '../exec.js';

function rejectionMessage(input: unknown): string | undefined {
  const r = worktreePathSchema.safeParse(input);
  expect(r.success, `expected ${JSON.stringify(input)} to be rejected`).toBe(false);
  return r.error?.issues[0]?.message;
}

describe('worktreePathSchema (TDB:698)', () => {
  it('accepts an omitted worktree_path', () => {
    expect(worktreePathSchema.safeParse(undefined).success).toBe(true);
  });

  it('a relative path is rejected with the per-value "must be absolute" message', () => {
    const msg = rejectionMessage('relative/tdb-698');
    expect(msg, 'zod 4 must not collapse the reason to "Invalid input"').not.toBe(
      'Invalid input',
    );
    expect(msg).toBe(validateWorktreePath('relative/tdb-698'));
    expect(msg).toContain('"relative/tdb-698"');
  });

  it('a missing absolute path is rejected with the per-value "does not exist" message', () => {
    const missing = '/nonexistent-tdb-698/worktree';
    const msg = rejectionMessage(missing);
    expect(msg).toBe(validateWorktreePath(missing));
    expect(msg).toMatch(/does not exist on disk/);
  });
});
