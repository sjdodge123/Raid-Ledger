// ROK-1470 — weight defaults for the fleet's heavy-task admission gate.
//
// The orchestrator gates `--weight heavy` tasks on host MemAvailable. These
// tests pin WHICH tool invocations are classified heavy by default, and that
// an explicit `weight` param always wins.
import { describe, it, expect } from 'vitest';
import {
  resolveBuildImageWeight,
  resolveCommandWeight,
  resolveValidateCiWeight,
  weightFlag,
} from '../task-weight.js';

describe('resolveCommandWeight (rl_run_on_runner)', () => {
  it.each([
    'npx jest --coverage',
    'npm run test -w api',
    'cd web && npx vitest run',
    'npx playwright test --project=desktop',
    'NODE_OPTIONS=--max-old-space-size=4096 npx jest api/src',
  ])('classifies %s as heavy when it runs a test framework', (command) => {
    // `npm run test -w api` is heavy via the npm-test signal, the rest via jest/vitest/playwright.
    expect(resolveCommandWeight(command)).toBe('heavy');
  });

  it.each([
    'ls -la',
    'git rev-parse --short HEAD',
    'cat package.json',
    'grep -rn jester src/', // substring only — not the jest binary
  ])('classifies %s as light', (command) => {
    expect(resolveCommandWeight(command)).toBe('light');
  });

  it('lets an explicit weight override the default in both directions', () => {
    expect(resolveCommandWeight('npx jest', 'light')).toBe('light');
    expect(resolveCommandWeight('ls', 'heavy')).toBe('heavy');
  });
});

describe('resolveValidateCiWeight (rl_validate_ci)', () => {
  it('defaults to heavy — a bare run is the full pipeline', () => {
    expect(resolveValidateCiWeight([])).toBe('heavy');
  });

  it.each([['--full'], ['--only-unit'], ['--only-integration'], ['--only-e2e'], ['--with-e2e']])(
    'classifies %s as heavy',
    (flag) => {
      expect(resolveValidateCiWeight([flag])).toBe('heavy');
    },
  );

  it('classifies a --static-only run as light (build + tsc + lint)', () => {
    expect(resolveValidateCiWeight(['--static'])).toBe('light');
    expect(resolveValidateCiWeight(['--static', '--no-e2e'])).toBe('light');
  });

  it('keeps --static heavy when it is combined with a forced e2e run', () => {
    expect(resolveValidateCiWeight(['--static', '--with-e2e'])).toBe('heavy');
  });

  it('lets an explicit weight override the default', () => {
    expect(resolveValidateCiWeight(['--full'], 'light')).toBe('light');
    expect(resolveValidateCiWeight(['--static'], 'heavy')).toBe('heavy');
  });
});

describe('resolveBuildImageWeight (rl_env_build_image_from_runner)', () => {
  it('is heavy by default — a docker build of the allinone image is the heaviest job on the fleet', () => {
    expect(resolveBuildImageWeight()).toBe('heavy');
  });

  it('honors an explicit override', () => {
    expect(resolveBuildImageWeight('light')).toBe('light');
  });
});

describe('weightFlag', () => {
  it('renders a trailing-space task-start flag fragment', () => {
    expect(weightFlag('heavy')).toBe('--weight heavy ');
    expect(weightFlag('light')).toBe('--weight light ');
  });
});
