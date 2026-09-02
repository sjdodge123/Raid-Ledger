// ROK-1467 — rl_validate_ci forwards the narrowing flags to validate-ci.sh.
//
// `resolveArgs` is the whole seam: the MCP boundary takes booleans (so the
// schema can document them) and the runner receives flags. Pure function, no
// SSH — the dispatch path around it is covered by the exec/argv specs.
import { describe, it, expect } from 'vitest';
import { resolveArgs } from '../tools/validate-ci.js';

describe('rl_validate_ci resolveArgs', () => {
  it('defaults to the caller-supplied args only', () => {
    expect(resolveArgs({})).toEqual([]);
    expect(resolveArgs({ args: ['--no-e2e'] })).toEqual(['--no-e2e']);
  });

  it('maps each boolean onto its validate-ci.sh flag', () => {
    expect(resolveArgs({ only_integration: true })).toEqual(['--only-integration']);
    expect(resolveArgs({ only_unit: true })).toEqual(['--only-unit']);
    expect(resolveArgs({ no_coverage: true })).toEqual(['--no-coverage']);
  });

  it('composes --only-unit with --no-coverage, preserving raw args first', () => {
    expect(resolveArgs({ args: ['--ci'], only_unit: true, no_coverage: true })).toEqual([
      '--ci',
      '--only-unit',
      '--no-coverage',
    ]);
  });

  it('does not duplicate a flag already present in args', () => {
    expect(resolveArgs({ args: ['--only-integration'], only_integration: true })).toEqual([
      '--only-integration',
    ]);
  });

  it('omits flags for false/undefined so the default gate is unchanged', () => {
    expect(
      resolveArgs({ only_integration: false, only_unit: false, no_coverage: false }),
    ).toEqual([]);
  });
});
