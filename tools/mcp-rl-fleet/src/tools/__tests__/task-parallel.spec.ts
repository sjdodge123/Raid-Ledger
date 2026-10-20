// ROK-1793 S2 — rl_task_status `parallel` derivation for a parallel gate parent.
import { describe, it, expect } from 'vitest';
import { parallelParentUnmerged, withParallelInfo } from '../task-parallel.js';
import { TaskChildSchema } from '../task-schemas.js';

const CHILDREN = [
  { task_id: 'abcdef12a', role: 'a' as const, slot: 1, borrowed: false },
  { task_id: 'abcdef12b', role: 'b' as const, slot: 3, borrowed: true },
];

describe('withParallelInfo', () => {
  it('keeps the orchestrator-recorded value', () => {
    const s = { ok: true, steps: [], children: CHILDREN, parallel: { mode: 'serial_fallback' as const, borrowed_slot: null } };
    expect(withParallelInfo(s).parallel).toEqual({ mode: 'serial_fallback', borrowed_slot: null });
  });
  it('derives parallel + the borrowed slot from children[]', () => {
    expect(withParallelInfo({ ok: true, steps: [], children: CHILDREN }).parallel).toEqual({
      mode: 'parallel',
      borrowed_slot: 3,
    });
  });
  it('derives serial_fallback from the log line, and nothing for a plain run', () => {
    const fb = withParallelInfo({ ok: true, steps: [], log_tail: '[parallel] fallback: serial (no free slot)\n' });
    expect(fb.parallel).toEqual({ mode: 'serial_fallback', borrowed_slot: null });
    expect(withParallelInfo({ ok: true, steps: [], log_tail: 'x' }).parallel).toBeUndefined();
  });
});

describe('parallelParentUnmerged', () => {
  it('is true for a split parent with no merged table, false once merged or for a plain run', () => {
    expect(parallelParentUnmerged({ ok: true, steps: [], children: CHILDREN, log_tail: 'Lint (all): PASS' })).toBe(true);
    expect(
      parallelParentUnmerged({ ok: true, steps: [], children: CHILDREN, log_tail: '[parallel] merged: 6 rows from 2 children' }),
    ).toBe(false);
    expect(parallelParentUnmerged({ ok: true, steps: [], log_tail: 'Lint (all): PASS' })).toBe(false);
  });
});

// ROK-1793 S2 review P3: gate-fanout records each child's terminal status + exit.
describe('children[] outcome fields', () => {
  it('keeps status and exit through the status schema', () => {
    const child = { task_id: 'abcdef12345a', role: 'a', slot: 1, borrowed: false, status: 'failed', exit: 1 };
    expect(TaskChildSchema.parse(child)).toMatchObject({ status: 'failed', exit: 1 });
  });
});
