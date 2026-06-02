// sync-guard — pre-build staleness detection for rl_env_deploy
// (TECH-DEBT 2026-06-02 "rl_env_deploy served stale build").
//
// The guard writes a per-call sentinel into the worktree, flushes Mutagen,
// reads it back out of the runner's /workspace, and force-resyncs on mismatch.
// We mock the three I/O boundaries it touches:
//   - exec.js   → execFileP (git rev-parse + mutagen flush) and runRl (resync)
//   - run-on-runner.js → execute() (the sentinel read-back through the runner)
//   - node:fs/promises → writeFile/unlink (the local sentinel)
//
// The key trick: writeFile captures the token the guard generated (it embeds
// Date.now()+nonce we can't predict), and the run-on-runner mock echoes that
// captured value back to simulate a HEALTHY sync, or returns something else to
// simulate a STALE /workspace.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileP = vi.fn();
const runRl = vi.fn();
const parseJsonFromStdout = vi.fn((..._a: unknown[]) => ({ ok: true }));
vi.mock('../exec.js', () => ({
  execFileP: (...a: unknown[]) => execFileP(...a),
  runRl: (...a: unknown[]) => runRl(...a),
  parseJsonFromStdout: (...a: unknown[]) => parseJsonFromStdout(...a),
}));

const runOnRunnerExecute = vi.fn();
vi.mock('../tools/run-on-runner.js', () => ({
  execute: (...a: unknown[]) => runOnRunnerExecute(...a),
}));

let lastWrittenToken = '';
const writeFile = vi.fn(async (...args: unknown[]) => {
  lastWrittenToken = String(args[1]).trim();
});
const unlink = vi.fn(async (..._a: unknown[]) => {});
vi.mock('node:fs/promises', () => ({
  writeFile: (...a: unknown[]) => writeFile(...a),
  unlink: (...a: unknown[]) => unlink(...a),
}));

import { ensureSyncedHead, SENTINEL_PREFIX } from '../sync-guard.js';

const HEAD = 'e9995e61aabbccddeeff00112233445566778899';
const OLD_HEAD = '776527b0000000000000000000000000000000aa';

/** Default: git resolves to HEAD; mutagen flush succeeds. */
function wireGitAndFlush(opts: { flushRejects?: boolean } = {}): void {
  execFileP.mockImplementation((cmd: string) => {
    if (cmd === 'git') return Promise.resolve({ stdout: `${HEAD}\n`, stderr: '' });
    if (cmd === 'mutagen') {
      if (opts.flushRejects) {
        const e = new Error('flush failed') as Error & { stderr?: string };
        e.stderr = 'unable to flush session: session is halted';
        return Promise.reject(e);
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  });
}

/** Make the runner echo the freshly-written token (healthy sync). */
function runnerEchoesToken(): void {
  runOnRunnerExecute.mockImplementation(async () => ({
    ok: true,
    stdout: lastWrittenToken,
    stderr: '',
    exit_code: 0,
  }));
}

beforeEach(() => {
  execFileP.mockReset();
  runRl.mockReset();
  parseJsonFromStdout.mockReset();
  parseJsonFromStdout.mockReturnValue({ ok: true });
  runOnRunnerExecute.mockReset();
  writeFile.mockClear();
  unlink.mockClear();
  lastWrittenToken = '';
  runRl.mockResolvedValue({ stdout: '{"ok":true,"resynced":true}', stderr: '', exitCode: 0 });
});

describe('ensureSyncedHead', () => {
  it('happy path: /workspace already matches laptop HEAD → ok, no resync, 1 probe', async () => {
    wireGitAndFlush();
    runnerEchoesToken();

    const res = await ensureSyncedHead({ slot: 2, worktree_path: '/wt' });

    expect(res.ok).toBe(true);
    expect(res.expected_head).toBe(HEAD);
    expect(res.synced_head).toBe(HEAD);
    expect(res.resynced).toBe(false);
    expect(res.attempts).toBe(1);
    expect(runRl).not.toHaveBeenCalled();
    // Sentinel was written into the worktree under a per-call probe name and cleaned up.
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(String(writeFile.mock.calls[0][0])).toContain(SENTINEL_PREFIX);
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it('wedged then recovered: first probe stale → force-resync → second probe matches', async () => {
    wireGitAndFlush();
    let call = 0;
    runOnRunnerExecute.mockImplementation(async () => {
      call++;
      // 1st probe: stale (old token); 2nd probe (post-resync): current token.
      return call === 1
        ? { ok: true, stdout: `${OLD_HEAD}:stale:deadbeef`, stderr: '', exit_code: 0 }
        : { ok: true, stdout: lastWrittenToken, stderr: '', exit_code: 0 };
    });

    const res = await ensureSyncedHead({ slot: 1, worktree_path: '/wt' });

    expect(res.ok).toBe(true);
    expect(res.resynced).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.synced_head).toBe(HEAD);
    expect(runRl).toHaveBeenCalledTimes(1);
    expect(runRl).toHaveBeenCalledWith(['resync'], expect.objectContaining({ cwd: '/wt' }));
  });

  it('wedged permanently: both probes stale → fail loud (sync_stuck), never claims synced', async () => {
    wireGitAndFlush();
    runOnRunnerExecute.mockResolvedValue({
      ok: true,
      stdout: `${OLD_HEAD}:stale:deadbeef`,
      stderr: '',
      exit_code: 0,
    });

    const res = await ensureSyncedHead({ slot: 3, worktree_path: '/wt' });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('sync_stuck');
    expect(res.expected_head).toBe(HEAD);
    expect(res.synced_head).toBeNull();
    expect(res.resynced).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.message).toMatch(/stuck|stale/i);
    // A resync was attempted exactly once before giving up.
    expect(runRl).toHaveBeenCalledTimes(1);
    // Sentinel always cleaned up even on the failure path.
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it('non-git worktree: no HEAD to verify → skipped, ok=true, never blocks', async () => {
    execFileP.mockImplementation((cmd: string) => {
      if (cmd === 'git') return Promise.reject(new Error('not a git repository'));
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const res = await ensureSyncedHead({ slot: 1, worktree_path: '/not-a-repo' });

    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.expected_head).toBeNull();
    expect(runOnRunnerExecute).not.toHaveBeenCalled();
    expect(runRl).not.toHaveBeenCalled();
  });

  it('flush failure is NEVER good even when the sentinel matches: forces a resync', async () => {
    // Codex high-2: a sentinel that landed before the session halted must not
    // authorize a build. Probe 1 matches but flush fails => not good => resync.
    // After resync, flush succeeds + matches => ok.
    let call = 0;
    execFileP.mockImplementation((cmd: string) => {
      if (cmd === 'git') return Promise.resolve({ stdout: `${HEAD}\n`, stderr: '' });
      if (cmd === 'mutagen') {
        call++;
        if (call === 1) {
          const e = new Error('flush failed') as Error & { stderr?: string };
          e.stderr = 'session is halted';
          return Promise.reject(e);
        }
        return Promise.resolve({ stdout: '', stderr: '' }); // flush ok after resync
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });
    runnerEchoesToken(); // content always matches

    const res = await ensureSyncedHead({ slot: 4, worktree_path: '/wt' });

    expect(res.ok).toBe(true);
    expect(res.resynced).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.flush_ok).toBe(true);
    expect(runRl).toHaveBeenCalledWith(['resync'], expect.objectContaining({ cwd: '/wt' }));
  });

  it('flush keeps failing despite a content match: fails loud (sync_stuck, flush_ok=false)', async () => {
    // Matched sentinel + permanently-halted flush must NOT authorize a build.
    wireGitAndFlush({ flushRejects: true });
    runnerEchoesToken();

    const res = await ensureSyncedHead({ slot: 4, worktree_path: '/wt' });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('sync_stuck');
    expect(res.flush_ok).toBe(false);
    expect(res.synced_head).toBeNull();
    expect(res.message).toMatch(/flush/i);
  });

  it('passes a bounded timeout to the resync child process', async () => {
    wireGitAndFlush();
    runOnRunnerExecute.mockResolvedValue({
      ok: true,
      stdout: `${OLD_HEAD}:stale:deadbeef`,
      stderr: '',
      exit_code: 0,
    });

    await ensureSyncedHead({ slot: 1, worktree_path: '/wt', resync_timeout_ms: 99_000 });

    expect(runRl).toHaveBeenCalledWith(['resync'], { cwd: '/wt', timeoutMs: 99_000 });
  });
});
