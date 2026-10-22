// 2026-10-22 — a green `validate-ci.sh --scoped` run writes the pre-push
// sentinel with gate_tier `scoped`.
//
// `--scoped` builds / typechecks / lints ONLY the diff's own targets, so its
// rows must be judged as a scoped run and nothing else: a narrowed pass may
// never be labelled `static` (the whole-monorepo tier), a FAIL row anywhere
// voids it, and an all-SKIPPED run (nothing was checked) is not evidence.
// Fixtures come from validate-ci.sh's REAL print_summary so the parser and
// the printer cannot drift apart unnoticed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSentinel, recordTaskSha, resolveGateTier, SENTINEL_PREFIX } from '../playwright-sentinel.js';
import { scopedGateGreen } from '../gate-summary.js';
import { resolveValidateCiWeight } from '../tools/task-weight.js';
import { resolveValidateCiTimeout } from '../tools/validate-ci-timeout.js';
import { checkE2eSpecs } from '../tools/validate-ci-target.js';
import type { ExecuteStatusReturn } from '../tools/task-schemas.js';

const VALIDATE_CI = join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/validate-ci.sh');

function extractFunction(name: string): string {
  const src = readFileSync(VALIDATE_CI, 'utf8');
  const start = src.indexOf(`${name}() {`);
  if (start < 0) throw new Error(`${name} not found in validate-ci.sh`);
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`unterminated ${name} in validate-ci.sh`);
  return src.slice(start, end + 3);
}

/** A summary block printed by validate-ci.sh's own print_summary. */
function realSummary(rows: Array<[string, string]>): string {
  const script = [
    'set -uo pipefail',
    'GREEN=""; RED=""; YELLOW=""; NC=""',
    `CHECK_NAMES=(${rows.map((r) => JSON.stringify(r[0])).join(' ')})`,
    `CHECK_RESULTS=(${rows.map((r) => JSON.stringify(r[1])).join(' ')})`,
    extractFunction('print_summary'),
    'print_summary',
  ].join('\n');
  return execFileSync('bash', ['-c', script], { encoding: 'utf8' });
}

const SHA = '8fd1f515';
const SURFACE = 'b2c3d4e5f6a1';
const TASK_ID = 'a1b2c3d4e5f6';
let dir = '';
let mapPath = '';

/** The row set run_scoped_gate prints for a smoke-spec-only diff. */
const SMOKE_ONLY: Array<[string, string]> = [
  ['Scoped plan (smoke)', 'PASS'],
  ['Build (scoped)', 'PASS'],
  ['TypeScript (scoped)', 'PASS'],
  ['Lint (scoped)', 'SKIPPED'],
];

function status(rows: Array<[string, string]>, over: Partial<ExecuteStatusReturn> = {}): ExecuteStatusReturn {
  return { ok: true, task_id: TASK_ID, mcp_runtime_status: 'succeeded', steps: [], log_tail: realSummary(rows), ...over };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scoped-sentinel-'));
  mapPath = join(dir, 'state', 'validate-ci-shas.json');
  recordTaskSha(TASK_ID, SHA, mapPath, SURFACE);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sentinelPath = (): string => join(dir, `${SENTINEL_PREFIX}${SURFACE}`);

describe('evaluateSentinel — scoped tier', () => {
  it('writes the sentinel with tier scoped for a green --scoped run', () => {
    const result = evaluateSentinel(status(SMOKE_ONLY), { dir, mapPath });

    expect(result?.gate_verified).toBe(true);
    expect(result?.gate_tier).toBe('scoped');
    expect(existsSync(sentinelPath())).toBe(true);
    expect(JSON.parse(readFileSync(sentinelPath(), 'utf8'))).toMatchObject({ surface: SURFACE, tier: 'scoped' });
  });

  it('labels a --scoped run scoped even when all three rows PASS (never static)', () => {
    const rows: Array<[string, string]> = [
      ['Scoped plan (api)', 'PASS'],
      ['Build (scoped)', 'PASS'],
      ['TypeScript (scoped)', 'PASS'],
      ['Lint (scoped)', 'PASS'],
    ];
    expect(resolveGateTier(status(rows))).toBe('scoped');
  });

  it('writes nothing when any row FAILs', () => {
    const rows: Array<[string, string]> = [...SMOKE_ONLY.slice(0, 2), ['TypeScript (scoped)', 'FAIL']];
    const result = evaluateSentinel(status(rows), { dir, mapPath });

    expect(result?.gate_verified).toBe(false);
    expect(result?.gate_tier).toBeNull();
    expect(existsSync(sentinelPath())).toBe(false);
  });

  it('writes nothing for an all-SKIPPED run — it checked nothing', () => {
    const rows: Array<[string, string]> = [
      ['Scoped plan (none)', 'PASS'],
      ['Build (scoped)', 'SKIPPED'],
      ['TypeScript (scoped)', 'SKIPPED'],
      ['Lint (scoped)', 'SKIPPED'],
    ];
    expect(scopedGateGreen(realSummary(rows))).toBe(false);
    expect(resolveGateTier(status(rows))).toBeNull();
  });

  it('writes nothing when the run died before reporting Lint', () => {
    expect(resolveGateTier(status(SMOKE_ONLY.slice(0, 3)))).toBeNull();
  });

  it('writes nothing for a failed task even when every row it printed passed', () => {
    expect(resolveGateTier(status(SMOKE_ONLY, { mcp_runtime_status: 'failed' }))).toBeNull();
  });

  it('leaves a --static run on the static tier', () => {
    const rows: Array<[string, string]> = [
      ['Build (all workspaces)', 'PASS'],
      ['TypeScript (all)', 'PASS'],
      ['Lint (all)', 'PASS'],
    ];
    expect(resolveGateTier(status(rows))).toBe('static');
  });
});

describe('--scoped dispatch wiring', () => {
  it('runs at weight medium unless a suite flag makes it heavy', () => {
    expect(resolveValidateCiWeight(['--scoped'])).toBe('medium');
    expect(resolveValidateCiWeight(['--static'])).toBe('light');
    expect(resolveValidateCiWeight(['--scoped', '--with-e2e'])).toBe('heavy');
  });

  it('takes the short (narrowed) watchdog budget', () => {
    expect(resolveValidateCiTimeout(['--scoped'])).toBe(resolveValidateCiTimeout(['--static']));
    expect(resolveValidateCiTimeout(['--scoped'])).toBeLessThan(resolveValidateCiTimeout([]));
  });

  it('rejects an e2e_specs list alongside --scoped (no Playwright tier runs)', () => {
    expect(checkE2eSpecs(['scripts/smoke/a.smoke.spec.ts'], 'auto', ['--scoped'])).toMatch(/--scoped/);
  });
});
