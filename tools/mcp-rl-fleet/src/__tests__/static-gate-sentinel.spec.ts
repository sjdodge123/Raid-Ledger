// ROK-1565 — a green `--static` fleet gate is enough to write the pre-push
// sentinel.
//
// Measured 2026-09-14: a 5-line web fix spent 15–25 min in the fleet Playwright
// tier, queued behind two branches, and found nothing GitHub's full suite would
// not have found ~45 min later. The fleet gate's unique value is the 4-minute
// static tier, so THAT is what the sentinel keys on now: terminal + succeeded,
// Build/TypeScript/Lint all PASS, and no row anywhere FAILing. A SKIPPED
// Playwright row no longer blocks the sentinel; a FAIL row still does.
//
// The sentinel body (and the tool result) records WHICH tier earned it, so an
// operator reading a task result can tell a 4-minute static PASS from a full
// Playwright PASS.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSentinel, recordTaskSha, SENTINEL_PREFIX } from '../playwright-sentinel.js';
import { playwrightRowStatus } from '../gate-summary.js';
import type { ExecuteStatusReturn } from '../tools/task-schemas.js';

const VALIDATE_CI = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../scripts/validate-ci.sh',
);

/** A function body, lifted out of validate-ci.sh verbatim. */
function extractFunction(name: string): string {
  const src = readFileSync(VALIDATE_CI, 'utf8');
  const start = src.indexOf(`${name}() {`);
  if (start < 0) throw new Error(`${name} not found in validate-ci.sh`);
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`unterminated ${name} in validate-ci.sh`);
  return src.slice(start, end + 3);
}

/**
 * A summary block printed by validate-ci.sh's OWN `print_summary`.
 *
 * Review BLOCKER 2: an earlier revision hand-wrote two-space rows that the real
 * printer never emits — `%-30s` pads only names SHORTER than 30 chars, so the
 * 45-char scoped Playwright label came out with a ONE-space gap and the parser
 * missed it. Every fixture here therefore comes from the real printf, so the
 * specs fail the moment the printer and the parser drift apart.
 */
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
const SURFACE = 'a1b2c3d4e5f6';
const TASK_ID = 'f6e5d4c3b2a1';

let dir = '';
let mapPath = '';

const STATIC_ROWS: Array<[string, string]> = [
  ['Build (all workspaces)', 'PASS'],
  ['TypeScript (all)', 'PASS'],
  ['Lint (all)', 'PASS'],
  ['Shell parse check (scripts/*.sh)', 'PASS'],
];

/** A real SUMMARY block with the static rows green, plus any extra rows. */
function summary(...extra: Array<[string, string]>): string {
  return realSummary([...STATIC_ROWS, ...extra]);
}

function status(over: Partial<ExecuteStatusReturn> = {}): ExecuteStatusReturn {
  return {
    ok: true,
    task_id: TASK_ID,
    mcp_runtime_status: 'succeeded',
    steps: [],
    log_tail: summary(),
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'static-sentinel-'));
  mapPath = join(dir, 'state', 'validate-ci-shas.json');
  recordTaskSha(TASK_ID, SHA, mapPath, SURFACE);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sentinelPath = (): string => join(dir, `${SENTINEL_PREFIX}${SURFACE}`);

describe('evaluateSentinel — static tier (ROK-1565)', () => {
  it('writes the sentinel for a --static run with no Playwright row at all', () => {
    const result = evaluateSentinel(status(), { dir, mapPath });

    expect(result?.gate_verified).toBe(true);
    expect(result?.gate_tier).toBe('static');
    expect(result?.gate_sentinel).toBe(sentinelPath());
    expect(existsSync(sentinelPath())).toBe(true);
  });

  it('keeps playwright_verified / playwright_sentinel as aliases of the gate fields', () => {
    const result = evaluateSentinel(status(), { dir, mapPath });

    expect(result?.playwright_verified).toBe(result?.gate_verified);
    expect(result?.playwright_sentinel).toBe(result?.gate_sentinel);
  });

  it('records the tier in the sentinel body', () => {
    evaluateSentinel(status(), { dir, mapPath });

    const body: unknown = JSON.parse(readFileSync(sentinelPath(), 'utf8'));
    expect(body).toMatchObject({ sha: SHA, surface: SURFACE, tier: 'static' });
  });

  it('writes it when Playwright is SKIPPED but the static rows are green', () => {
    const result = evaluateSentinel(
      status({
        log_tail: summary(['Playwright (desktop + mobile)', 'SKIPPED']),
      }),
      { dir, mapPath },
    );

    expect(result?.gate_verified).toBe(true);
    expect(result?.gate_tier).toBe('static');
  });

  it('reports the playwright tier when the Playwright row PASSed', () => {
    const result = evaluateSentinel(
      status({ log_tail: summary(['Playwright (desktop + mobile)', 'PASS']) }),
      { dir, mapPath },
    );

    expect(result?.gate_verified).toBe(true);
    expect(result?.gate_tier).toBe('playwright');
    const body: unknown = JSON.parse(readFileSync(sentinelPath(), 'utf8'));
    expect(body).toMatchObject({ tier: 'playwright' });
  });

  it('parses the SCOPED row the real printer emits, one-space gap and all', () => {
    // The direct printer<->parser pin. `%-30s` pads nothing for a 45-char name,
    // so this row really does arrive with a single space before the status.
    const block = summary(['Playwright (desktop + mobile, scoped: 3 specs)', 'PASS']);
    const row = block
      .split('\n')
      .find((l) => l.startsWith('Playwright (desktop + mobile, scoped'));

    expect(row).toBeDefined();
    // The printf fix itself: `%-30s  %s` keeps a two-space separator for ANY
    // name length, so the doc/CI greps that read this row keep working too.
    expect(row).toMatch(/\)\s{2,}PASS$/);
    expect(playwrightRowStatus(block)).toBe('PASS');
  });

  it('reports the playwright tier for a SCOPED Playwright row', () => {
    // ROK-1565 Cluster B renames the row when the run was scoped by
    // scope-specs.sh. The parser must still recognise it.
    const result = evaluateSentinel(
      status({
        log_tail: summary(['Playwright (desktop + mobile, scoped: 3 specs)', 'PASS']),
      }),
      { dir, mapPath },
    );

    expect(result?.gate_tier).toBe('playwright');
  });

  it('does NOT write it when Playwright FAILed, however green the static rows', () => {
    const result = evaluateSentinel(
      status({
        mcp_runtime_status: 'failed',
        script_exit_code: 1,
        log_tail: summary(['Playwright (desktop + mobile)', 'FAIL']),
      }),
      { dir, mapPath },
    );

    expect(result?.gate_verified).toBe(false);
    expect(result?.gate_tier).toBe(null);
    expect(existsSync(sentinelPath())).toBe(false);
  });

  it('does NOT write it when any OTHER row FAILed', () => {
    const result = evaluateSentinel(
      status({
        mcp_runtime_status: 'failed',
        script_exit_code: 1,
        log_tail: summary(['Integration tests (api)', 'FAIL']),
      }),
      { dir, mapPath },
    );

    expect(result?.gate_verified).toBe(false);
    expect(existsSync(sentinelPath())).toBe(false);
  });

  it('does NOT write it when a static row is missing (the gate never got there)', () => {
    const result = evaluateSentinel(
      status({
        log_tail: realSummary([
          ['Build (all workspaces)', 'PASS'],
          ['Lint (all)', 'PASS'],
        ]),
      }),
      { dir, mapPath },
    );

    expect(result?.gate_verified).toBe(false);
  });

  it('does NOT write it for a task that is terminal but cancelled or killed', () => {
    const result = evaluateSentinel(
      status({ mcp_runtime_status: 'cancelled' }),
      { dir, mapPath },
    );

    expect(result?.gate_verified).toBe(false);
    expect(existsSync(sentinelPath())).toBe(false);
  });

  it('does NOT write it when the static rows are green but the task failed', () => {
    // A `--fleet` run that died after the static tier with no summary FAIL row
    // (killed step, missing row) is not evidence the gate was green.
    const result = evaluateSentinel(
      status({ mcp_runtime_status: 'failed', script_exit_code: 1 }),
      { dir, mapPath },
    );

    expect(result?.gate_verified).toBe(false);
  });
});
