import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Mock config so PROJECT_DIR / MAIN_REPO are deterministic and the script path
// resolves predictably.
vi.mock('../config.js', () => ({
  PROJECT_DIR: '/fake/project',
  MAIN_REPO: '/fake/main',
  IS_WORKTREE: false,
}));

// Mock the shell() utility — it's the boundary between the TS wrapper and the
// bash script, so tests verify command shape + JSON parsing without ever
// running env-lock.sh.
const mockShell = vi.fn();
vi.mock('../shell.js', () => ({
  shell: (...args: unknown[]) => mockShell(...args),
}));

// Import after mocks are registered.
import {
  executeStatus,
  executeAcquire,
  executeRelease,
  executeForceRelease,
  getAgentId,
  STATUS_TOOL_NAME,
  ACQUIRE_TOOL_NAME,
  RELEASE_TOOL_NAME,
  FORCE_RELEASE_TOOL_NAME,
  _setAgentIdFilePathForTesting,
} from './env-lock.js';

// Per-test isolated persisted-agent-id file. Override before each test so
// fs.readFile/writeFile in the production code can't bleed across tests or
// touch the operator's real ~/.raid-ledger/mcp-agent-id.
let agentIdFile: string;

beforeEach(() => {
  mockShell.mockReset();
  agentIdFile = join(tmpdir(), `env-lock-test-${randomBytes(6).toString('hex')}.id`);
  _setAgentIdFilePathForTesting(agentIdFile);
});

afterEach(async () => {
  _setAgentIdFilePathForTesting(null);
  await fs.unlink(agentIdFile).catch(() => {
    /* fine if it didn't exist */
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Queue a single shell() response with stdout=<JSON of given object>. */
function queueShellJson(response: object): void {
  mockShell.mockResolvedValueOnce({
    stdout: JSON.stringify(response),
    stderr: '',
    exitCode: 0,
  });
}

/** Queue a plain string as the next shell() stdout (used for `git branch --show-current`). */
function queueShellRaw(stdout: string): void {
  mockShell.mockResolvedValueOnce({ stdout, stderr: '', exitCode: 0 });
}

/** Pull the command string from a recorded shell() call. */
function lastCommand(): string {
  const calls = mockShell.mock.calls;
  return calls[calls.length - 1]?.[0] as string;
}

// ---------------------------------------------------------------------------
// Tool name + description constants
// ---------------------------------------------------------------------------

describe('env-lock tool registration constants', () => {
  it('exports stable tool names', () => {
    expect(STATUS_TOOL_NAME).toBe('env_lock_status');
    expect(ACQUIRE_TOOL_NAME).toBe('env_lock_acquire');
    expect(RELEASE_TOOL_NAME).toBe('env_lock_release');
    expect(FORCE_RELEASE_TOOL_NAME).toBe('env_lock_force_release');
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe('executeStatus', () => {
  it('returns the parsed JSON when env is free', async () => {
    queueShellJson({ holder: null, queue: [], free: true, stale_cleared: null });

    const result = await executeStatus();

    expect(result).toEqual({ holder: null, queue: [], free: true, stale_cleared: null });
    expect(lastCommand()).toMatch(/bash '\/fake\/main\/scripts\/env-lock\.sh' status/);
  });

  it('returns parsed holder info when env is held', async () => {
    queueShellJson({
      holder: { branch: 'rok-1248', purpose: 'smoke', pid: 123, priority: 'normal' },
      queue: [],
      free: false,
      stale_cleared: null,
    });

    const result = (await executeStatus()) as { holder: { branch: string }; free: boolean };

    expect(result.holder.branch).toBe('rok-1248');
    expect(result.free).toBe(false);
  });

  it('returns an error envelope when stdout is not JSON', async () => {
    mockShell.mockResolvedValueOnce({ stdout: 'oops not json', stderr: '', exitCode: 1 });

    const result = (await executeStatus()) as { error: string; raw: string };

    expect(result.error).toMatch(/non-JSON/);
    expect(result.raw).toBe('oops not json');
  });
});

// ---------------------------------------------------------------------------
// acquire
// ---------------------------------------------------------------------------

describe('executeAcquire', () => {
  it('builds the correct command for an explicit branch + worktree + pid', async () => {
    queueShellJson({ acquired: true, holder: { branch: 'b' }, queue: [] });

    await executeAcquire({
      branch: 'b',
      worktree: '/wt',
      purpose: 'unit-test',
      pid: 4321,
      ttl_minutes: 30,
      priority: 'normal',
    });

    const cmd = lastCommand();
    expect(cmd).toContain("acquire 'b' '/wt' 'unit-test'");
    expect(cmd).toContain('--pid 4321');
    expect(cmd).toContain('--ttl-minutes 30');
    expect(cmd).toContain('--priority normal');
  });

  it('omits --pid when no pid is provided', async () => {
    queueShellJson({ acquired: true, holder: {}, queue: [] });

    await executeAcquire({ branch: 'b', worktree: '/wt', purpose: 'p' });

    expect(lastCommand()).not.toContain('--pid');
  });

  it('auto-defaults branch via git and worktree via cwd', async () => {
    queueShellRaw('detected-branch'); // git branch --show-current
    queueShellJson({ acquired: true, holder: {}, queue: [] }); // acquire

    await executeAcquire({ purpose: 'auto-detect' });

    const calls = mockShell.mock.calls;
    expect(calls[0]?.[0]).toMatch(/git -C '.*' branch --show-current/);
    expect(calls[1]?.[0]).toContain("'detected-branch'");
    expect(calls[1]?.[0]).toContain(`'${process.cwd()}'`);
  });

  it('falls back to "unknown" branch when git output is empty', async () => {
    queueShellRaw(''); // git returns nothing (detached HEAD)
    queueShellJson({ acquired: true, holder: {}, queue: [] });

    await executeAcquire({ purpose: 'detached' });

    expect(mockShell.mock.calls[1]?.[0]).toContain("'unknown'");
  });

  it('passes --priority operator through to the script', async () => {
    queueShellJson({
      acquired: true,
      holder: { branch: 'opt-runner' },
      queue: [{ branch: 'displaced', preempted: true }],
      preempted_holder: { branch: 'displaced' },
    });

    const result = (await executeAcquire({
      branch: 'opt-runner',
      worktree: '/wt',
      purpose: 'operator-test',
      priority: 'operator',
    })) as { acquired: boolean; preempted_holder: { branch: string } };

    expect(lastCommand()).toContain('--priority operator');
    expect(result.acquired).toBe(true);
    expect(result.preempted_holder.branch).toBe('displaced');
  });

  it('returns acquired:false with my_position when env is held', async () => {
    queueShellJson({
      acquired: false,
      holder: { branch: 'someone-else' },
      queue: [{ branch: 'me' }],
      my_position: 0,
    });

    const result = (await executeAcquire({
      branch: 'me',
      worktree: '/wt',
      purpose: 'queued',
    })) as { acquired: boolean; my_position: number };

    expect(result.acquired).toBe(false);
    expect(result.my_position).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------

describe('executeRelease', () => {
  it('passes branch and worktree through, returns parsed JSON', async () => {
    // ENV-4 fix: executeRelease now calls executeStatus first to read the
    // holder's stamped agent_id. Tests must mock BOTH calls in order:
    // status first, then the release.
    queueShellJson({ holder: null, queue: [], free: true, stale_cleared: null });
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [] });

    const result = (await executeRelease({ branch: 'b', worktree: '/wt' })) as {
      released: boolean;
      was_holder: boolean;
    };

    expect(lastCommand()).toContain("release 'b' '/wt'");
    expect(result.released).toBe(true);
    expect(result.was_holder).toBe(true);
  });

  it('reports was_holder:false when caller was only queued', async () => {
    queueShellJson({ holder: { branch: 'other' }, queue: [], free: false, stale_cleared: null });
    queueShellJson({ released: true, was_holder: false, holder: { branch: 'other' }, queue: [] });

    const result = (await executeRelease({ branch: 'queued-one', worktree: '/wt' })) as {
      was_holder: boolean;
    };

    expect(result.was_holder).toBe(false);
  });

  it('auto-defaults branch + worktree when omitted', async () => {
    queueShellRaw('current-branch'); // git branch --show-current
    queueShellJson({ holder: null, queue: [], free: true, stale_cleared: null }); // executeStatus
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [] }); // release

    await executeRelease({});

    // call[0]=git, call[1]=status, call[2]=release
    expect(mockShell.mock.calls[2]?.[0]).toContain("'current-branch'");
    expect(mockShell.mock.calls[2]?.[0]).toContain(`'${process.cwd()}'`);
  });
});

// ---------------------------------------------------------------------------
// force-release
// ---------------------------------------------------------------------------

describe('executeForceRelease', () => {
  it('shells force-release and returns the cleared holder', async () => {
    queueShellJson({ cleared_holder: { branch: 'stuck' }, holder: null, queue: [] });

    const result = (await executeForceRelease()) as { cleared_holder: { branch: string } };

    expect(lastCommand()).toMatch(/force-release$/);
    expect(result.cleared_holder.branch).toBe('stuck');
  });

  it('handles force-release when env was already free (cleared_holder:null)', async () => {
    queueShellJson({ cleared_holder: null, holder: null, queue: [] });

    const result = (await executeForceRelease()) as { cleared_holder: null };

    expect(result.cleared_holder).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// agent_id (ROK-1318)
// ---------------------------------------------------------------------------

describe('getAgentId', () => {
  it('is deterministic for the same (branch, worktree)', () => {
    expect(getAgentId('rok-1318', '/Users/x/Projects/Raid-Ledger--rok-1318')).toBe(
      getAgentId('rok-1318', '/Users/x/Projects/Raid-Ledger--rok-1318'),
    );
  });

  it('changes when branch changes', () => {
    expect(getAgentId('rok-1318', '/wt')).not.toBe(getAgentId('rok-1319', '/wt'));
  });

  it('changes when worktree changes', () => {
    expect(getAgentId('rok-1318', '/wt-a')).not.toBe(getAgentId('rok-1318', '/wt-b'));
  });

  it('returns a 16-char lowercase hex string', () => {
    expect(getAgentId('rok-1318', '/wt')).toMatch(/^[a-f0-9]{16}$/);
  });

  it('uses a sentinel separator so branch/worktree boundary is unambiguous', () => {
    // Without a delimiter, hash("ab", "c") === hash("a", "bc") would collide.
    expect(getAgentId('ab', 'c')).not.toBe(getAgentId('a', 'bc'));
  });
});

describe('executeAcquire — agent_id plumbing (ROK-1318)', () => {
  it('passes --agent-id derived from branch+worktree on every acquire', async () => {
    queueShellJson({ acquired: true, holder: {}, queue: [] });

    await executeAcquire({ branch: 'rok-1318', worktree: '/wt', purpose: 'p' });

    const expectedId = getAgentId('rok-1318', '/wt');
    expect(lastCommand()).toContain(`--agent-id '${expectedId}'`);
  });

  it('derives agent_id from auto-detected branch + cwd when neither is provided', async () => {
    queueShellRaw('auto-branch'); // git branch --show-current
    queueShellJson({ acquired: true, holder: {}, queue: [] });

    await executeAcquire({ purpose: 'auto-detect-agent' });

    const expectedId = getAgentId('auto-branch', process.cwd());
    expect(mockShell.mock.calls[1]?.[0]).toContain(`--agent-id '${expectedId}'`);
  });
});

describe('executeRelease — agent_id plumbing (ROK-1318)', () => {
  it('passes --agent-id derived from branch+worktree on release', async () => {
    // ENV-4: status call first (no holder → fall through to computed id), then release.
    queueShellJson({ holder: null, queue: [], free: true, stale_cleared: null });
    queueShellJson({
      released: true,
      was_holder: true,
      holder: null,
      queue: [],
      matched_by: 'agent_id',
    });

    await executeRelease({ branch: 'rok-1318', worktree: '/wt' });

    const expectedId = getAgentId('rok-1318', '/wt');
    const cmd = lastCommand();
    expect(cmd).toContain("release 'rok-1318' '/wt'");
    expect(cmd).toContain(`--agent-id '${expectedId}'`);
  });

  it('release auto-detect uses derived agent_id from cwd + git branch', async () => {
    queueShellRaw('detected'); // git branch
    queueShellJson({ holder: null, queue: [], free: true, stale_cleared: null }); // status
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [] }); // release

    await executeRelease({});

    const expectedId = getAgentId('detected', process.cwd());
    // call[0]=git, call[1]=status, call[2]=release
    expect(mockShell.mock.calls[2]?.[0]).toContain(`--agent-id '${expectedId}'`);
  });

  it('acquire + release produce the same agent_id for the same (branch, worktree)', async () => {
    queueShellJson({ acquired: true, holder: {}, queue: [] });
    await executeAcquire({ branch: 'rok-1318', worktree: '/wt', purpose: 'p' });
    const acquireCmd = lastCommand();

    // ENV-4 persist-to-file: release reads the agent_id stamped by acquire
    // directly from the persisted file — no status call, no fresh derivation.
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [] });
    await executeRelease({ branch: 'rok-1318', worktree: '/wt' });
    const releaseCmd = lastCommand();

    // Extract the agent_id token from each command and confirm equality. This
    // is the invariant the bug fix turns on: bash's is_holder_by_agent on the
    // release side has to match what acquire stamped.
    const extract = (cmd: string): string | null => cmd.match(/--agent-id '([a-f0-9]+)'/)?.[1] ?? null;
    expect(extract(acquireCmd)).not.toBeNull();
    expect(extract(acquireCmd)).toBe(extract(releaseCmd));
  });
});

// ---------------------------------------------------------------------------
// ENV-4 — three-tier agent_id resolution (persist-to-file primary)
// Codex pre-push review 2026-05-23 flagged the cwd-drift scenario; the fix
// stamps the agent_id ONCE on acquire to a stable on-disk path and reads it
// back on release. Status-based fallback handles fresh-MCP-install cases;
// fresh derivation is the last-resort same-as-pre-ENV-4 path.
// ---------------------------------------------------------------------------

describe('executeRelease — Tier 1: persisted-file path (ENV-4 fix)', () => {
  it('uses the persisted agent_id from acquire, even when release cwd drifts to a different (branch, worktree)', async () => {
    // Acquire stamps an agent_id derived from (branch='rok-1318', worktree='/wt-a').
    queueShellJson({ acquired: true, holder: {}, queue: [] });
    await executeAcquire({ branch: 'rok-1318', worktree: '/wt-a', purpose: 'p' });
    const stampedAgentId = getAgentId('rok-1318', '/wt-a');

    // Release is called from a TOTALLY DIFFERENT cwd context (operator's
    // MCP server now in main repo, releasing a sibling worktree's lease).
    // Without the persist-to-file fix, the wrapper would compute sha1('main',
    // '/main-repo') ≠ stamped, AND bash's is_holder_self would miss because
    // holder.worktree='/wt-a' ≠ '/main-repo'. The persisted file ensures
    // the wrapper uses the stamped id regardless of cwd drift.
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [], matched_by: 'agent_id' });
    await executeRelease({ branch: 'main', worktree: '/main-repo' });

    expect(lastCommand()).toContain(`--agent-id '${stampedAgentId}'`);
    // Make doubly sure: the release should NOT carry the freshly-derived
    // (main, /main-repo) id — that's the bug shape Codex caught.
    const wrongId = getAgentId('main', '/main-repo');
    expect(lastCommand()).not.toContain(`--agent-id '${wrongId}'`);
  });

  it('persisted path bypasses the status-call fallback entirely', async () => {
    // Pre-write a persisted agent_id (simulating a prior acquire).
    await fs.writeFile(agentIdFile, 'persisted-from-prior-acquire-id');
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [] });

    await executeRelease({ branch: 'any', worktree: '/any' });

    // Only ONE shell call should have happened (the release). No status call.
    expect(mockShell.mock.calls.length).toBe(1);
    expect(lastCommand()).toContain("--agent-id 'persisted-from-prior-acquire-id'");
  });

  it('clears the persisted file on a successful release (was_holder=true)', async () => {
    await fs.writeFile(agentIdFile, 'will-be-cleared');
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [] });

    await executeRelease({ branch: 'b', worktree: '/wt' });

    await expect(fs.readFile(agentIdFile, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('keeps the persisted file on a no-op release (was_holder=false)', async () => {
    await fs.writeFile(agentIdFile, 'still-our-stake');
    queueShellJson({ released: true, was_holder: false, holder: { branch: 'other' }, queue: [] });

    await executeRelease({ branch: 'b', worktree: '/wt' });

    const contents = await fs.readFile(agentIdFile, 'utf8');
    expect(contents).toBe('still-our-stake');
  });
});

describe('executeRelease — Tier 2: status-based fallback', () => {
  it('reuses the holder\'s stamped agent_id when holder.worktree matches ours AND no persisted file', async () => {
    // No persisted file (fresh MCP install, /tmp wiped, etc.) but a holder
    // exists with a stamped agent_id and matching worktree.
    const stampedAgentId = 'stamped1234567a';
    queueShellJson({
      holder: {
        branch: 'rok-1318',
        worktree: '/wt',
        purpose: 'p',
        pid: 1,
        priority: 'normal',
        acquired_at: '2026-05-23T00:00:00Z',
        heartbeat_at: '2026-05-23T00:00:00Z',
        ttl_minutes: 60,
        preempted_from: null,
        agent_id: stampedAgentId,
      },
      queue: [],
      free: false,
      stale_cleared: null,
    });
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [], matched_by: 'agent_id' });

    // Caller releases with a DIFFERENT branch (post-checkout) but same worktree.
    await executeRelease({ branch: 'main', worktree: '/wt' });

    const cmd = lastCommand();
    expect(cmd).toContain(`--agent-id '${stampedAgentId}'`);
  });

  it('does NOT use holder.agent_id when holder.worktree does NOT match (no identity theft)', async () => {
    queueShellJson({
      holder: {
        branch: 'other',
        worktree: '/other-wt',
        purpose: 'p',
        pid: 1,
        priority: 'normal',
        acquired_at: '2026-05-23T00:00:00Z',
        heartbeat_at: '2026-05-23T00:00:00Z',
        ttl_minutes: 60,
        preempted_from: null,
        agent_id: 'someoneelseagent',
      },
      queue: [],
      free: false,
      stale_cleared: null,
    });
    queueShellJson({ released: true, was_holder: false, holder: null, queue: [], matched_by: null });

    await executeRelease({ branch: 'b', worktree: '/wt' });

    const expectedId = getAgentId('b', '/wt');
    expect(lastCommand()).toContain(`--agent-id '${expectedId}'`);
    expect(lastCommand()).not.toContain("'someoneelseagent'");
  });

  it('falls back to computed agent_id when status returns no holder', async () => {
    queueShellJson({ holder: null, queue: [], free: true, stale_cleared: null });
    queueShellJson({ released: true, was_holder: false, holder: null, queue: [], matched_by: null });

    await executeRelease({ branch: 'b', worktree: '/wt' });

    const expectedId = getAgentId('b', '/wt');
    expect(lastCommand()).toContain(`--agent-id '${expectedId}'`);
  });

  it('falls back to computed agent_id when status query returns an error envelope', async () => {
    mockShell.mockResolvedValueOnce({ stdout: 'oops not json', stderr: '', exitCode: 1 });
    queueShellJson({ released: true, was_holder: true, holder: null, queue: [] });

    await executeRelease({ branch: 'b', worktree: '/wt' });

    const expectedId = getAgentId('b', '/wt');
    expect(lastCommand()).toContain(`--agent-id '${expectedId}'`);
  });
});

describe('executeForceRelease — clears the persisted file', () => {
  it('drops the local agent_id stamp so the next acquire starts clean', async () => {
    await fs.writeFile(agentIdFile, 'wedged-stamp');
    queueShellJson({ cleared_holder: { branch: 'stuck' }, holder: null, queue: [] });

    await executeForceRelease();

    await expect(fs.readFile(agentIdFile, 'utf8')).rejects.toThrow(/ENOENT/);
  });
});

describe('executeAcquire — persists agent_id to disk (ENV-4)', () => {
  it('writes the stamped agent_id to the on-disk file before the shell call', async () => {
    queueShellJson({ acquired: true, holder: {}, queue: [] });

    await executeAcquire({ branch: 'rok-1318', worktree: '/wt', purpose: 'p' });

    const expectedId = getAgentId('rok-1318', '/wt');
    const persisted = await fs.readFile(agentIdFile, 'utf8');
    expect(persisted).toBe(expectedId);
  });

  it('overwrites an existing persisted stamp on each acquire (no stale-stamp bleed)', async () => {
    await fs.writeFile(agentIdFile, 'stale-from-prior-test');
    queueShellJson({ acquired: true, holder: {}, queue: [] });

    await executeAcquire({ branch: 'rok-1318', worktree: '/wt', purpose: 'p' });

    const expectedId = getAgentId('rok-1318', '/wt');
    const persisted = await fs.readFile(agentIdFile, 'utf8');
    expect(persisted).toBe(expectedId);
    expect(persisted).not.toBe('stale-from-prior-test');
  });
});

// ---------------------------------------------------------------------------
// Quoting / argument safety
// ---------------------------------------------------------------------------

describe('shell argument quoting', () => {
  it('escapes single quotes in branch / worktree / purpose', async () => {
    queueShellJson({ acquired: true, holder: {}, queue: [] });

    await executeAcquire({
      branch: "weird'branch",
      worktree: "/path/with'quote",
      purpose: "purpose'with-quote",
    });

    const cmd = lastCommand();
    // single quote should be replaced with the standard '\'' shell escape
    expect(cmd).toContain("'weird'\\''branch'");
    expect(cmd).toContain("'/path/with'\\''quote'");
    expect(cmd).toContain("'purpose'\\''with-quote'");
  });

  it('safely quotes worktree paths in detectBranch (no command substitution)', async () => {
    // A malicious worktree path with $() must not be expanded by the shell.
    queueShellRaw('detected-branch'); // git command result
    queueShellJson({ acquired: true, holder: {}, queue: [] });

    await executeAcquire({
      worktree: '/tmp/$(rm -rf /)evil',
      purpose: 'inject-test',
    });

    const gitCmd = mockShell.mock.calls[0]?.[0] as string;
    // Single-quoted: $(...) is treated as literal text, not a substitution.
    expect(gitCmd).toContain("git -C '/tmp/$(rm -rf /)evil'");
    expect(gitCmd).not.toMatch(/git -C "/);
  });
});
