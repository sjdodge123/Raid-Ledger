// Fleet Playwright PASS -> pre-push sentinel (operator ruling 2026-09-12).
//
// The settings.json PreToolUse hook denies `git push` on a web/src branch
// unless `/tmp/.playwright-verified-<short sha>` exists. These specs pin the
// things that keep that gate honest:
//   * the PLAYWRIGHT STEP decides, not the script exit code — a task that
//     `failed` at a LATER tier (Discord smoke on a checkout with no
//     tools/test-bot/.env) still writes the sentinel when Playwright passed,
//   * a SKIPPED, FAILED or absent Playwright tier never writes it, whatever
//     the task's own status,
//   * the sha comes from what was RECORDED at dispatch, not from whatever the
//     worktree happens to point at when the status is observed.
//
// Both the sentinel dir and the task->sha map are injected, so nothing here
// touches the real /tmp or ~/.raid-ledger.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('does NOT write it when the task failed AND Playwright itself FAILed', () => {
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

  it('does NOT write it when the task failed with no Playwright row at all', () => {
    // The tier never ran (the script died earlier). Absent is not a pass.
    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);

    const result = evaluateSentinel(
      status({
        mcp_runtime_status: 'failed',
        script_exit_code: 1,
        steps: [{ name: 'Build (all workspaces)', status: 'FAIL', duration_s: 12 }],
        log_tail: 'Build (all workspaces)  FAIL\nnpm ERR! tsc exited 2',
      }),
      { dir, mapPath },
    );

    expect(result).toEqual({ playwright_verified: false, playwright_sentinel: null });
    expect(existsSync(join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`))).toBe(false);
  });

  it('DOES write it when Playwright PASSed and a LATER step failed the task', () => {
    // The ROK-1533 case: validate-ci.sh stops at the first failing step, so the
    // Discord smoke tier (no tools/test-bot/.env on a fresh worktree) drives the
    // whole task to `failed` — after Playwright already passed 795/0 for this
    // sha. The gate asks about Playwright, so this must verify.
    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);

    const result = evaluateSentinel(
      status({
        mcp_runtime_status: 'failed',
        script_exit_code: 1,
        steps: [
          { name: 'Playwright (desktop + mobile)', status: 'PASS', duration_s: 612 },
          { name: 'Discord smoke (companion bot)', status: 'FAIL', duration_s: 3 },
        ],
        // No SUMMARY block: the script died before printing one.
        log_tail: 'Discord smoke (companion bot) ...\nERROR: TEST_BOT_TOKEN is not set',
      }),
      { dir, mapPath },
    );

    expect(result).toEqual({
      playwright_verified: true,
      playwright_sentinel: join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`),
    });
    expect(existsSync(join(dir, `${SENTINEL_PREFIX}${SYNCED_SHA}`))).toBe(true);
  });

  it('does NOT write it for a cancelled or killed run, even on a PASS row', () => {
    // Terminal, but the log is truncated — a PASS seen there is not evidence
    // that the tier completed.
    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);

    for (const runtime of ['cancelled', 'killed_timeout'] as const) {
      const result = evaluateSentinel(status({ mcp_runtime_status: runtime }), {
        dir,
        mapPath,
      });
      expect(result).toEqual({ playwright_verified: false, playwright_sentinel: null });
    }
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

  it('reports NOT verified when the sentinel write fails (Codex P3)', () => {
    // The hook checks for the file, so a failed write means the push is still
    // denied — claiming verified:true there would mislead the agent. A regular
    // file standing where the directory should be makes mkdir/write throw.
    recordTaskSha(TASK_ID, SYNCED_SHA, mapPath);
    const blocked = join(dir, 'not-a-dir');
    writeFileSync(blocked, 'i am a file');

    const result = evaluateSentinel(status(), { dir: blocked, mapPath });

    expect(result).toEqual({ playwright_verified: false, playwright_sentinel: null });
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
