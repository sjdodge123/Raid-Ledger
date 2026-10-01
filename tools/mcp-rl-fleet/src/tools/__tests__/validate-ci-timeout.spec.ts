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

  it('defaults a run narrowed by --static / --only-unit / --only-integration to 1800s', () => {
    expect(resolveValidateCiTimeout(['--static'])).toBe(1800);
    expect(resolveValidateCiTimeout(['--only-unit', '--no-coverage'])).toBe(1800);
    expect(resolveValidateCiTimeout(['--only-integration'])).toBe(1800);
  });

  it.each([['--fleet'], ['--only-e2e'], ['--with-e2e']])(
    'defaults a %s run to 5400s',
    (flag) => {
      expect(resolveValidateCiTimeout(['--no-coverage', flag])).toBe(5400);
    },
  );

  // Codex P2: validate-ci.sh with no args IS the full pipeline (unit + sharded
  // integration + e2e-auto on a web-surface diff), and --full is its no-op alias.
  it('defaults a bare (no-arg) run to 5400s — the script default is the full pipeline', () => {
    expect(resolveValidateCiTimeout([]), 'bare validate-ci.sh is a full run').toBe(5400);
  });

  it.each([[['--full']], [['--no-e2e']], [['--full', '--no-coverage', '--ci']]])(
    'defaults the un-narrowed full run %j to 5400s',
    (args) => {
      expect(resolveValidateCiTimeout(args)).toBe(5400);
    },
  );

  it('lets a narrowing flag win over --full (the script treats --full as a no-op)', () => {
    expect(resolveValidateCiTimeout(['--full', '--static'])).toBe(1800);
    expect(resolveValidateCiTimeout(['--full', '--only-unit'])).toBe(1800);
  });

  it('keeps an explicit e2e flag long even when a narrowing flag is present', () => {
    expect(resolveValidateCiTimeout(['--static', '--with-e2e'])).toBe(5400);
  });

  it('does not match a flag that merely contains a long-gate flag as a substring', () => {
    expect(resolveValidateCiTimeout(['--only-unit', '--no-e2e'])).toBe(1800);
  });

  it('lets an explicit timeout_seconds win in both directions', () => {
    expect(resolveValidateCiTimeout(['--fleet'], 900)).toBe(900);
    expect(resolveValidateCiTimeout(['--static'], 3600)).toBe(3600);
  });

  it('clamps an explicit value to the [60, 7200] window task-start accepts', () => {
    expect(resolveValidateCiTimeout(['--static'], 5)).toBe(60);
    expect(resolveValidateCiTimeout(['--fleet'], 99999)).toBe(7200);
  });
});
