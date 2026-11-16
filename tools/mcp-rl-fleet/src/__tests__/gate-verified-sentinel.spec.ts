// ROK-2205 — the pre-push sentinel is written ONLY for a gate_verified run.
//
// 2026-11-15: a `--full` gate (task 2e251bacf2a3) reported every row PASS while
// the runner was synced to an old main commit, and the sentinel was written
// anyway. A run whose synced HEAD is not the HEAD recorded at dispatch, or
// whose status already carries `gate_verified: false`, must write nothing, and
// every sentinel that IS written records `gate_verified: true` — the push hook
// (scripts/smoke/push-gate.sh) refuses any sentinel that does not.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateSentinel, recordTaskSha, SENTINEL_PREFIX } from '../playwright-sentinel.js';
import type { ExecuteStatusReturn } from '../tools/task-schemas.js';

const SHA = '8fd1f515';
const FULL_SHA = `${SHA}0123456789abcdef0123456789abcdef`;
const OLD_MAIN = '1e2d3c4b5a69788796a5b4c3d2e1f00112233445';
const SURFACE = 'a1b2c3d4e5f6';
const TASK_ID = 'ab12cd34ef56';

/** A SUMMARY block in validate-ci.sh's `%-30s  %s` row format. */
function summary(rows: Array<[string, string]>): string {
  const line = (a: string, b: string): string => `${a.padEnd(30)}  ${b}`;
  return [
    '========== Summary ==========',
    line('Check', 'Result'),
    line('-----', '------'),
    ...rows.map(([n, r]) => line(n, r)),
    '',
  ].join('\n');
}

const GREEN = summary([
  ['Build (all workspaces)', 'PASS'],
  ['TypeScript (all)', 'PASS'],
  ['Lint (all)', 'PASS'],
]);

function status(over: Partial<ExecuteStatusReturn> = {}): ExecuteStatusReturn {
  return {
    ok: true,
    task_id: TASK_ID,
    mcp_runtime_status: 'succeeded',
    steps: [],
    log_tail: GREEN,
    ...over,
  };
}

let dir = '';
let mapPath = '';
const sentinelPath = (): string => join(dir, `${SENTINEL_PREFIX}${SURFACE}`);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gate-verified-sentinel-'));
  mapPath = join(dir, 'state', 'validate-ci-shas.json');
  recordTaskSha(TASK_ID, SHA, mapPath, SURFACE);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('evaluateSentinel — gate_verified is required (ROK-2205)', () => {
  it('writes NO sentinel for an all-PASS run synced to another (stale) HEAD', () => {
    const result = evaluateSentinel(status({ synced_head: OLD_MAIN }), { dir, mapPath });

    expect(result?.gate_verified).toBe(false);
    expect(result?.gate_sentinel).toBeNull();
    expect(existsSync(sentinelPath())).toBe(false);
    expect(result?.gate_error).toMatch(/stale sync/i);
    expect(result?.gate_error).toContain(OLD_MAIN.slice(0, 8));
  });

  it('writes NO sentinel when expected_head and synced_head disagree', () => {
    const result = evaluateSentinel(
      status({ expected_head: FULL_SHA, synced_head: OLD_MAIN }),
      { dir, mapPath },
    );

    expect(result?.gate_verified).toBe(false);
    expect(existsSync(sentinelPath())).toBe(false);
  });

  it('writes NO sentinel when the terminal status already says gate_verified: false', () => {
    const upstream = status({ gate_verified: false });
    const result = evaluateSentinel(upstream, { dir, mapPath });

    expect(result?.gate_verified).toBe(false);
    expect(existsSync(sentinelPath())).toBe(false);
    expect(result?.gate_error).toMatch(/gate_verified/);
  });

  it('writes the sentinel when the synced HEAD is the HEAD recorded at dispatch', () => {
    const result = evaluateSentinel(status({ synced_head: FULL_SHA }), { dir, mapPath });

    expect(result?.gate_verified).toBe(true);
    expect(existsSync(sentinelPath())).toBe(true);
  });

  it('records gate_verified: true in every sentinel body it writes', () => {
    evaluateSentinel(status(), { dir, mapPath });

    const body: unknown = JSON.parse(readFileSync(sentinelPath(), 'utf8'));
    expect(body).toMatchObject({ gate_verified: true, sha: SHA, surface: SURFACE });
  });
});
