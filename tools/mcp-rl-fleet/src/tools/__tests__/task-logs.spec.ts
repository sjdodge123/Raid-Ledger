// ROK-1338 PR-2 — rl_task_logs tests.
//
// Mirrors task-inspect.spec.ts / infra-logs.spec.ts: vi.mock('node:child_process')
// to stub SSH, then assert on argv shape + parsed return shape.
//
// Coverage required by dev-brief:
//   - happy path
//   - defense-in-depth validation (invalid input rejected BEFORE shell)
//   - structural error path (missing file)
//   - empty / truncated stdout
//   - SSH failure (non-zero exit + stderr)
//   - tool-specific: lines param default + cap + invalid; follow:true defer.

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

import { execute, TaskLogsParamsSchema } from '../task-logs.js';

function execFileOk(stdout: string, stderr = ''): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, stdout, stderr);
    },
  );
}

function execFileFail(stderr: string, code: number | string = 1, stdout = ''): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      const err = Object.assign(new Error(stderr), { code, stderr, stdout });
      callback(err, stdout, stderr);
    },
  );
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('rl_task_logs — Zod schema', () => {
  it('accepts valid task_id + default lines (omitted)', () => {
    const parsed = TaskLogsParamsSchema.safeParse({ task_id: 'abc123def' });
    expect(parsed.success).toBe(true);
  });

  it('accepts lines up to 5000', () => {
    expect(
      TaskLogsParamsSchema.safeParse({ task_id: 'abc123def', lines: 5000 }).success,
    ).toBe(true);
  });

  it('rejects lines > 5000', () => {
    expect(
      TaskLogsParamsSchema.safeParse({ task_id: 'abc123def', lines: 5001 }).success,
    ).toBe(false);
  });

  it('rejects negative lines', () => {
    expect(
      TaskLogsParamsSchema.safeParse({ task_id: 'abc123def', lines: -1 }).success,
    ).toBe(false);
  });

  it('rejects zero lines', () => {
    expect(
      TaskLogsParamsSchema.safeParse({ task_id: 'abc123def', lines: 0 }).success,
    ).toBe(false);
  });

  it('rejects non-integer lines (e.g. 12.5)', () => {
    expect(
      TaskLogsParamsSchema.safeParse({ task_id: 'abc123def', lines: 12.5 }).success,
    ).toBe(false);
  });

  it('rejects task_id with shell-metacharacters', () => {
    expect(
      TaskLogsParamsSchema.safeParse({ task_id: 'abc;rm -rf /' }).success,
    ).toBe(false);
  });

  it('rejects task_id outside 8-32 char range', () => {
    expect(TaskLogsParamsSchema.safeParse({ task_id: 'short' }).success).toBe(false);
    expect(
      TaskLogsParamsSchema.safeParse({ task_id: 'a'.repeat(33) }).success,
    ).toBe(false);
  });
});

describe('rl_task_logs — execute() happy path', () => {
  it('SSHes the VM with `tail -n <lines> /srv/rl-infra/state/tasks/<id>.log`', async () => {
    execFileOk('line one\nline two\nline three\n');
    const result = await execute({ task_id: 'abc123def', lines: 200 });
    expect(result.ok).toBe(true);
    expect(result.task_id).toBe('abc123def');
    expect(result.log_path).toBe('/srv/rl-infra/state/tasks/abc123def.log');
    expect(result.lines).toEqual(['line one', 'line two', 'line three']);
    expect(result.truncated).toBe(false);
    const call = mockExecFile.mock.calls[0];
    expect(call[0]).toBe('ssh');
    const remote = String(call[1].at(-1));
    expect(remote).toContain('tail -n 200');
    // The full log path (including task_id) is single-quoted via shellQuote
    // — defense in depth at the SSH boundary. The path as a whole becomes one
    // shell word; task_id can't escape its single-quoted enclosure.
    expect(remote).toContain("'/srv/rl-infra/state/tasks/abc123def.log'");
    // stderr merged to stdout so a single tail captures the whole tee.
    expect(remote).toContain('2>&1');
  });

  it('defaults lines to 100 when omitted', async () => {
    execFileOk('one\n');
    await execute({ task_id: 'abc123def' });
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    expect(remote).toContain('tail -n 100');
  });

  it('drops empty trailing newline entries from `lines`', async () => {
    execFileOk('a\nb\n\nc\n\n');
    const result = await execute({ task_id: 'abc123def', lines: 50 });
    expect(result.ok).toBe(true);
    // empty-after-split entries dropped (per spec output shape).
    expect(result.lines).toEqual(['a', 'b', 'c']);
  });

  it('returns ok:true with empty lines[] when log file has no content', async () => {
    execFileOk('');
    const result = await execute({ task_id: 'abc123def', lines: 100 });
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([]);
    expect(result.log_path).toBe('/srv/rl-infra/state/tasks/abc123def.log');
  });
});

describe('rl_task_logs — defense-in-depth validation', () => {
  it('rejects invalid task_id at the executor layer (no SSH spawned)', async () => {
    const result = await execute({ task_id: 'bad id with spaces' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects task_id containing shell metacharacters', async () => {
    const result = await execute({ task_id: 'abc;rm -rf /' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects oversize `lines` at the executor layer', async () => {
    const result = await execute({
      task_id: 'abc123def',
      lines: 99999,
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects negative `lines`', async () => {
    const result = await execute({
      task_id: 'abc123def',
      lines: -5,
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects fractional `lines`', async () => {
    const result = await execute({
      task_id: 'abc123def',
      lines: 12.5,
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe('rl_task_logs — structural error paths', () => {
  it('returns task_log_not_found when tail exits with ENOENT message', async () => {
    execFileFail(
      'tail: cannot open \'/srv/rl-infra/state/tasks/abc123def.log\' for reading: No such file or directory\n',
      1,
    );
    const result = await execute({ task_id: 'abc123def', lines: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task_log_not_found');
    expect(result.task_id).toBe('abc123def');
    expect(result.log_path).toBe('/srv/rl-infra/state/tasks/abc123def.log');
  });

  it('classifies tail "No such file or directory" arriving via stdout (2>&1 merged)', async () => {
    // The remote uses `2>&1`, so tail's error text arrives via stdout, not stderr.
    execFileFail(
      '',
      1,
      'tail: cannot open \'/srv/rl-infra/state/tasks/abc123def.log\' for reading: No such file or directory\n',
    );
    const result = await execute({ task_id: 'abc123def', lines: 50 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task_log_not_found');
  });

  it('returns ssh_unreachable on Connection refused (ROK-1338 PR-3)', async () => {
    execFileFail(
      'ssh: connect to host rl-infra port 22: Connection refused',
      255,
    );
    const result = await execute({ task_id: 'abc123def', lines: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ssh_unreachable');
    expect(result.message).toContain('Connection refused');
  });

  it('returns ssh_denied on Permission denied (publickey) (ROK-1338 PR-3)', async () => {
    execFileFail('rl-agent@rl-infra: Permission denied (publickey).', 255);
    const result = await execute({ task_id: 'abc123def', lines: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ssh_denied');
    expect(result.hint).toMatch(/post-ROK-1338|MCP tools/);
  });

  it('synthesizes a diagnostic when SSH exits non-zero with empty stderr', async () => {
    execFileFail('', 255);
    const result = await execute({ task_id: 'abc123def', lines: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task_logs_failed');
    // synthesizeEmptyStderrDiagnostic adds the [mcp-rl-fleet: ...] marker.
    expect(result.message).toContain('mcp-rl-fleet');
  });
});

describe('rl_task_logs — truncation on maxBuffer overflow', () => {
  it('returns truncated:true with partial bytes when 64KB cap is hit', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
        const err = Object.assign(new Error('stdout maxBuffer length exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          stdout: 'kept-line1\nkept-line2\n',
          stderr: '',
        });
        callback(err, 'kept-line1\nkept-line2\n', '');
      },
    );
    const result = await execute({ task_id: 'abc123def', lines: 5000 });
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.lines).toEqual(['kept-line1', 'kept-line2']);
    expect(result.log_path).toBe('/srv/rl-infra/state/tasks/abc123def.log');
  });
});

describe('rl_task_logs — follow:true v1 deferral', () => {
  it('returns error:"follow_not_implemented_in_v1" with hint when follow=true', async () => {
    const result = await execute({ task_id: 'abc123def', lines: 100, follow: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('follow_not_implemented_in_v1');
    expect(result.hint).toBeDefined();
    expect(result.hint).toMatch(/rl_task_status/);
    // No SSH spawned — we short-circuit before the shell.
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('passes through normally when follow=false (the default)', async () => {
    execFileOk('content\n');
    const result = await execute({ task_id: 'abc123def', lines: 10, follow: false });
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual(['content']);
  });
});

describe('rl_task_logs — dogfood #5 ANSI strip', () => {
  // Validate-ci colors its output. Without strip_ansi:true, agents see
  // `[0;32mPASS[0m` mixed into the line content.
  const ANSI_LINE = '[0;32mAll checks passed![0m';
  const PLAIN = 'All checks passed!';

  it('default (strip_ansi unset) leaves ANSI escapes verbatim', async () => {
    execFileOk(`${ANSI_LINE}\n`);
    const result = await execute({ task_id: 'abc123def', lines: 5 });
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([ANSI_LINE]);
  });

  it('strip_ansi:true strips SGR escapes from each line', async () => {
    execFileOk(`${ANSI_LINE}\n[1;33mSKIPPED[0m\nplain\n`);
    const result = await execute({ task_id: 'abc123def', strip_ansi: true });
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([PLAIN, 'SKIPPED', 'plain']);
  });

  it('strip_ansi:false is explicit no-op (parity with default)', async () => {
    execFileOk(`${ANSI_LINE}\n`);
    const result = await execute({ task_id: 'abc123def', strip_ansi: false });
    expect(result.lines).toEqual([ANSI_LINE]);
  });

  // Round-3 #5 — original CSI-only regex missed OSC (`ESC]…BEL`) sequences
  // (window-title, hyperlinks). Vendored regex now has the OSC branch.
  it('strips OSC window-title sequences (round-3 #5)', async () => {
    // ESC]0;some-title BEL
    execFileOk('\x1b]0;some-title\x07hello world\n');
    const result = await execute({ task_id: 'abc123def', strip_ansi: true });
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual(['hello world']);
  });

  it('strips OSC sequence terminated by ESC \\ (the ST alternative)', async () => {
    // ESC]8;;https://example.com ESC\ followed by plain text
    execFileOk('\x1b]8;;https://example.com\x1b\\link text\n');
    const result = await execute({ task_id: 'abc123def', strip_ansi: true });
    expect(result.lines).toEqual(['link text']);
  });

  it('preserves user-typed `[31m` literal text (no ESC prefix — not an escape)', async () => {
    // Round-3 brief: confirm the regex doesn't strip user-typed brackets.
    execFileOk('user typed [31m manually\n');
    const result = await execute({ task_id: 'abc123def', strip_ansi: true });
    expect(result.lines).toEqual(['user typed [31m manually']);
  });
});

describe('rl_task_logs — dogfood #4 unknown-key rejection', () => {
  it('rejects worktree_path (silent-strip would otherwise hide it)', async () => {
    const result = await execute({
      task_id: 'abc123def',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      worktree_path: '/Users/sdodge/foo',
    } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unknown_param');
    expect(result.message).toContain('worktree_path');
  });

  it('rejects arbitrary extra keys', async () => {
    const result = await execute({
      task_id: 'abc123def',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typo_param: true,
    } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unknown_param');
  });
});
