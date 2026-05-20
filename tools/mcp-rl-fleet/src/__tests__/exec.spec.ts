// ROK-1331 M2 Bug A — synthesize a diagnostic stderr line when ssh exits
// non-zero with empty stderr. The helper lives in src/exec.ts and is called
// at every task-start SSH call site in the wrappers.
import { describe, it, expect } from 'vitest';

// Bug-A export under test: this symbol does not yet exist — the test MUST
// fail (red) until M2 dev lands the helper in src/exec.ts.
import { synthesizeEmptyStderrDiagnostic } from '../exec.js';

describe('Bug A — synthesizeEmptyStderrDiagnostic()', () => {
  it('returns a fixed marker string when ssh exits non-zero with empty stderr', () => {
    const out = synthesizeEmptyStderrDiagnostic(255);
    expect(out).toContain('mcp-rl-fleet');
    expect(out).toContain('exit 255');
    // Causes hint MUST mention at least the recurring SSH failure modes.
    expect(out).toMatch(/command not found|shell init|dubious-ownership|connection drop/i);
  });

  it('includes the actual exit code in the diagnostic', () => {
    expect(synthesizeEmptyStderrDiagnostic(127)).toContain('127');
    expect(synthesizeEmptyStderrDiagnostic(1)).toContain('exit 1');
  });

  it('handles undefined exit code defensively', () => {
    // When err.code is missing, the helper should still produce a usable line.
    const out = synthesizeEmptyStderrDiagnostic(undefined as unknown as number);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('mcp-rl-fleet');
  });

  it('is a single line (no embedded newlines that would break log parsers)', () => {
    const out = synthesizeEmptyStderrDiagnostic(255);
    expect(out.split('\n').length).toBe(1);
  });
});
