// Fleet Playwright PASS -> pre-push sentinel (operator ruling 2026-09-12).
//
// The settings.json PreToolUse hook denies `git push` on a web/src branch
// unless `/tmp/.playwright-verified-<short sha>` exists. These specs pin the
// three things that keep that gate honest:
//   * only a SUCCEEDED task whose Playwright summary row says PASS writes it,
//   * SKIPPED and FAILED never write it,
//   * the sha comes from what was RECORDED at dispatch, not from whatever the
//     worktree happens to point at when the status is observed.
//
// Both the sentinel dir and the task->sha map are injected, so nothing here
// touches the real /tmp or ~/.raid-ledger.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateSentinel,
  lookupTaskSha,
  playwrightPassed,
  recordTaskSha,
  SENTINEL_PREFIX,
} from '../playwright-sentinel.js';
import type { ExecuteStatusReturn } from '../tools/task-schemas.js';

const SYNCED_SHA = '8fd1f515';
const OTHER_SHA = 'deadbee1';
const TASK_ID = 'a1b2c3d4e5f6';

let dir = '';
let mapPath = '';

function summary(row: string): string {
  return [
    '========== Summary ==========',
    'Check                          Result',
    '-----                          ------',
    'Build (all workspaces)         PASS',
    'Lint (all)                     PASS',
    row,
    'Discord smoke (companion bot)  SKIPPED',
  ].join('\n');
}

function status(over: Partial<ExecuteStatusReturn> = {}): ExecuteStatusReturn {
  return {
    ok: true,
    task_id: TASK_ID,
    mcp_runtime_status: 'succeeded',
    steps: [],
    log_tail: summary('Playwright (desktop + mobile)  PASS'),
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-sentinel-'));
  mapPath = join(dir, 'state', 'validate-ci-shas.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('evaluateSentinel', () => {
  it('writes the sentinel on a succeeded run whose Playwright row PASSed', () => {
    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);

    const result = evaluateSentinel(status(), { dir, mapPath });

    expect(result).toEqual({
      playwright_verified: true,
      playwright_sentinel: join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`),
    });
    expect(existsSync(join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`))).toBe(true);
  });

  it('does NOT write it when the Playwright row is SKIPPED', () => {
    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);

    const result = evaluateSentinel(
      status({
        log_tail: summary('Playwright (desktop + mobile)  SKIPPED — Dev env not responding'),
      }),
      { dir, mapPath },
    );

    expect(result).toEqual({ playwright_verified: false, playwright_sentinel: null });
    expect(existsSync(join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`))).toBe(false);
  });

  it('does NOT write it when the task itself failed', () => {
    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);

    const result = evaluateSentinel(
      status({
        mcp_runtime_status: 'failed',
        script_exit_code: 1,
        log_tail: summary('Playwright (desktop + mobile)  FAIL'),
      }),
      { dir, mapPath },
    );

    expect(result).toEqual({ playwright_verified: false, playwright_sentinel: null });
    expect(existsSync(join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`))).toBe(false);
  });

  it('names the sentinel after the RECORDED synced sha, not a later HEAD', () => {
    // Dispatch recorded SYNCED_SHA; by observation time another task (and the
    // worktree) has moved to OTHER_SHA. The sentinel must still be the one the
    // run actually covered.
    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);
    recordTaskSha('ffffffffffff', OTHER_SHA, mapPath);

    const result = evaluateSentinel(status(), { dir, mapPath });

    expect(lookupTaskSha(TASK_ID, mapPath)).toBe(SYNCED_SHA);
    expect(result?.playwright_sentinel).toBe(join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`));
    expect(existsSync(join(dir, `${SENTINEL_PREFIX}${OTHER_SHA}`))).toBe(false);
  });

  it('annotates nothing for a task with no recorded sha, or one still running', () => {
    expect(evaluateSentinel(status(), { dir, mapPath })).toBeNull();

    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);
    expect(
      evaluateSentinel(status({ mcp_runtime_status: 'running' }), { dir, mapPath }),
    ).toBeNull();
    expect(existsSync(join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`))).toBe(false);
  });
});

describe('playwrightPassed', () => {
  it('strips ANSI colour before reading the summary row', () => {
    const coloured = `Playwright (desktop + mobile)  [0;32mPASS[0m`;
    expect(playwrightPassed({ steps: [], log_tail: coloured })).toBe(true);
  });

  it('falls back to steps[] when the log tail carries no summary row', () => {
    expect(
      playwrightPassed({
        steps: [{ name: 'Playwright (desktop + mobile)', status: 'PASS', duration_s: 61 }],
        log_tail: 'no summary block in this tail',
      }),
    ).toBe(true);
    expect(
      playwrightPassed({
        steps: [
          { name: 'Playwright (desktop + mobile)', status: 'SKIPPED', duration_s: null },
        ],
        log_tail: '',
      }),
    ).toBe(false);
  });
});
