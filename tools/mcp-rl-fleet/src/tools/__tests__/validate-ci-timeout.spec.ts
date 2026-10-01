// TDB:1452 — rl_validate_ci's watchdog budget defaults by run shape.
import { describe, it, expect } from 'vitest';
import {
  resolveValidateCiTimeout,
  DEFAULT_VALIDATE_CI_TIMEOUT_S,
  LONG_GATE_VALIDATE_CI_TIMEOUT_S,
} from '../validate-ci-timeout.js';

describe('resolveValidateCiTimeout (TDB:1452)', () => {
  it('pins the two defaults the brief and the Lead skill rely on', () => {
    expect(DEFAULT_VALIDATE_CI_TIMEOUT_S).toBe(1800);
    expect(LONG_GATE_VALIDATE_CI_TIMEOUT_S).toBe(5400);
  });

  it('defaults a static / unit run to 1800s', () => {
    expect(resolveValidateCiTimeout([])).toBe(1800);
    expect(resolveValidateCiTimeout(['--static'])).toBe(1800);
    expect(resolveValidateCiTimeout(['--only-unit', '--no-coverage'])).toBe(1800);
  });

  it.each([['--fleet'], ['--only-e2e'], ['--with-e2e']])(
    'defaults a %s run to 5400s',
    (flag) => {
      expect(resolveValidateCiTimeout(['--no-coverage', flag])).toBe(5400);
    },
  );

  it('does not match a flag that merely contains a long-gate flag as a substring', () => {
    expect(resolveValidateCiTimeout(['--no-e2e'])).toBe(1800);
  });

  it('lets an explicit timeout_seconds win in both directions', () => {
    expect(resolveValidateCiTimeout(['--fleet'], 900)).toBe(900);
    expect(resolveValidateCiTimeout(['--static'], 3600)).toBe(3600);
  });

  it('clamps an explicit value to the [60, 7200] window task-start accepts', () => {
    expect(resolveValidateCiTimeout([], 5)).toBe(60);
    expect(resolveValidateCiTimeout(['--fleet'], 99999)).toBe(7200);
  });
});
