// ROK-1331 M5b — rl_task_status response extensions.
//
// M5b appends four optional fields to TaskStatusResultSchema:
//   - last_output_at   (ISO 8601, mtime of the .log file)
//   - last_line        (last non-empty line of .log, trimmed, ≤2048 chars)
//   - current_step     (most-recent `== <name> ==` step header from the log)
//   - progress_hint    (tool-aware: jest 'suite N of M' or docker 'step N of M')
//
// These tests target the schema shape + executeStatus parser. The orchestrator
// task-status binary already returns the four fields when the .log file is
// readable; executeStatus must surface them verbatim through the published
// schema. The progress_hint parser regex is asserted directly via the parser
// helper that M5b adds.

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

// NEW: parser helper exported by task.ts ONLY after M5b lands.
// Until the module exports `parseProgressHint`, this import drives the red.
import {
  executeStatus,
  TaskStatusResultSchema,
  parseProgressHint,
} from '../task.js';

function execFileOk(stdoutJson: unknown): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, JSON.stringify(stdoutJson), '');
    },
  );
}

const BASE_RUNNING = {
  ok: true,
  task_id: 'abc123def',
  tool: 'rl_validate_ci',
  slot: 1,
  args_summary: '--full',
  started_at: '2026-05-20T12:00:00.000Z',
  finished_at: null,
  elapsed_seconds: 240,
  mcp_runtime_status: 'running' as const,
  script_exit_code: null,
  steps: [],
  log_tail: '... building ...\n',
  log_url: 'https://fleet.gamernight.net/api/tasks/abc123def/log',
  log_path: '/srv/rl-infra/state/tasks/abc123def.log',
};

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('rl_task_status — M5b schema extensions', () => {
  it('TaskStatusResultSchema accepts last_output_at / last_line / current_step / progress_hint', () => {
    const payload = {
      ...BASE_RUNNING,
      last_output_at: '2026-05-20T12:03:58.123Z',
      last_line: '[heartbeat] elapsed=240s pid=4711 cpu=12.3% rss=512MB current_test=signups.spec.ts',
      current_step: 'Integration tests (api)',
      progress_hint: 'jest: suite 12 of 18',
    };
    expect(() => TaskStatusResultSchema.parse(payload)).not.toThrow();
  });

  it('all four extensions are OPTIONAL — schema parses without them (backward compat)', () => {
    expect(() => TaskStatusResultSchema.parse(BASE_RUNNING)).not.toThrow();
  });

  it('all four extensions accept null (when log not yet readable)', () => {
    expect(() =>
      TaskStatusResultSchema.parse({
        ...BASE_RUNNING,
        last_output_at: null,
        last_line: null,
        current_step: null,
        progress_hint: null,
      }),
    ).not.toThrow();
  });

  it('last_output_at must be ISO 8601 string when present', () => {
    expect(() =>
      TaskStatusResultSchema.parse({
        ...BASE_RUNNING,
        last_output_at: 'not-a-date',
      }),
    ).toThrow();
  });

  it('executeStatus surfaces the four new fields verbatim from the orchestrator stdout', async () => {
    execFileOk({
      ...BASE_RUNNING,
      last_output_at: '2026-05-20T12:03:58.123Z',
      last_line: '[heartbeat] elapsed=240s pid=4711 cpu=12.3% rss=512MB current_test=signups.spec.ts',
      current_step: 'Integration tests (api)',
      progress_hint: 'jest: suite 12 of 18',
    });
    const result = await executeStatus({ task_id: 'abc123def' });
    expect(result.last_output_at).toBe('2026-05-20T12:03:58.123Z');
    expect(result.last_line).toContain('[heartbeat]');
    expect(result.current_step).toBe('Integration tests (api)');
    expect(result.progress_hint).toBe('jest: suite 12 of 18');
  });
});

describe('parseProgressHint — tool-aware parser', () => {
  it('emits "jest: suite N of M" when validate-ci log contains jest verbose progress', () => {
    const log = [
      'PASS  api/src/foo/foo.spec.ts (45.123 s)',
      '  ✓ foo (10 ms)',
      'PASS  api/src/bar/bar.spec.ts (12 of 18)',
    ].join('\n');
    expect(parseProgressHint('rl_validate_ci', log)).toBe('jest: suite 12 of 18');
  });

  it('emits "jest: N tests total" when only the jest summary is available', () => {
    const log = [
      'Test Suites: 18 passed, 18 total',
      'Tests:       0 failed, 312 passed, 312 total',
      'Time:        45.123 s',
    ].join('\n');
    expect(parseProgressHint('rl_validate_ci', log)).toBe('jest: 312 tests total');
  });

  it('emits "docker build: step N of M" for env-build-image tool', () => {
    const log = [
      '#15 [build 12/45] RUN npm install',
      '#16 [build 12/45] CACHED',
      'Step 12/45 : RUN npm ci',
    ].join('\n');
    expect(parseProgressHint('rl_env_build_image_from_runner', log)).toBe('docker build: step 12 of 45');
  });

  it('returns null for unknown tools', () => {
    expect(parseProgressHint('rl_unknown_tool', 'some logs')).toBeNull();
  });

  it('returns null when log has no recognisable progress marker', () => {
    expect(parseProgressHint('rl_validate_ci', 'just some output\nno jest progress here\n')).toBeNull();
  });
});
