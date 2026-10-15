import { describe, expect, it } from 'vitest';
import { backfillStepDurations, parseStepTimes } from '../step-durations.js';

const TAIL = [
  '========== Build (all workspaces) ==========',
  '[step-time] Build (all workspaces) 45.2',
  '\u001b[0;32mBuild (all workspaces): PASS\u001b[0m',
  '[step-time] Playwright (desktop + mobile, scoped: 2 specs) 612.0',
  'Playwright (desktop + mobile, scoped: 2 specs): FAIL',
].join('\n');

describe('parseStepTimes', () => {
  it('reads every [step-time] line keyed by the full step name', () => {
    const times = parseStepTimes(TAIL);
    expect(times.get('Build (all workspaces)')).toEqual([45.2]);
    expect(times.get('Playwright (desktop + mobile, scoped: 2 specs)')).toEqual([612]);
    expect(times.size).toBe(2);
  });
});

describe('backfillStepDurations', () => {
  it('fills null durations from the log tail, matched by name', () => {
    const steps = [
      { name: 'Build (all workspaces)', status: 'PASS' as const, duration_s: null },
      { name: 'Playwright (desktop + mobile, scoped: 2 specs)', status: 'FAIL' as const, duration_s: null },
    ];
    expect(backfillStepDurations(steps, TAIL)).toEqual([
      { name: 'Build (all workspaces)', status: 'PASS', duration_s: 45.2 },
      { name: 'Playwright (desktop + mobile, scoped: 2 specs)', status: 'FAIL', duration_s: 612 },
    ]);
  });

  it('never overwrites a duration the orchestrator already set', () => {
    const steps = [{ name: 'Build (all workspaces)', status: 'PASS' as const, duration_s: 7 }];
    expect(backfillStepDurations(steps, TAIL)[0]?.duration_s).toBe(7);
  });

  it('leaves a step null when the tail has no line for it (old scripts, short tails)', () => {
    const steps = [{ name: 'Lint (all)', status: 'PASS' as const, duration_s: null }];
    expect(backfillStepDurations(steps, TAIL)[0]?.duration_s).toBeNull();
    expect(backfillStepDurations(steps, undefined)[0]?.duration_s).toBeNull();
  });
});
