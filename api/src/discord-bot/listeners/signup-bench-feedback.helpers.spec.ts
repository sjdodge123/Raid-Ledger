/**
 * ROK-626: Tests for Discord bench feedback helper.
 */
import { benchSuffix } from './signup-bench-feedback.helpers';

describe('benchSuffix', () => {
  it('returns bench notice when assignedSlot is bench', () => {
    const result = benchSuffix('bench');
    expect(result).toContain('bench');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty string when assignedSlot is not bench', () => {
    expect(benchSuffix('dps')).toBe('');
    expect(benchSuffix('tank')).toBe('');
    expect(benchSuffix('healer')).toBe('');
    expect(benchSuffix('player')).toBe('');
    expect(benchSuffix('flex')).toBe('');
  });

  it('returns empty string when assignedSlot is undefined', () => {
    expect(benchSuffix(undefined)).toBe('');
  });

  it('returns empty string when assignedSlot is null', () => {
    expect(benchSuffix(null)).toBe('');
  });
});
