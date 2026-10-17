/**
 * Adversarial tests for ROK-626: benchSuffix edge cases.
 * Tests exact content, all role types, and boundary inputs.
 */
import { benchSuffix } from './signup-bench-feedback.helpers';

describe('benchSuffix — content and formatting', () => {
  it('starts with a newline when bench', () => {
    const result = benchSuffix('bench');
    expect(result).toMatch(/^\n/);
  });

  it('contains Discord blockquote markdown when bench', () => {
    const result = benchSuffix('bench');
    expect(result).toContain('> ');
  });

  it('mentions promotion in the bench message', () => {
    const result = benchSuffix('bench');
    expect(result).toContain('promoted');
  });

  it('mentions roster is full in the bench message', () => {
    const result = benchSuffix('bench');
    expect(result).toContain('roster is full');
  });

  it('uses bold markdown for bench keyword', () => {
    const result = benchSuffix('bench');
    expect(result).toContain('**bench**');
  });
});

describe('benchSuffix — exhaustive non-bench coverage', () => {
  it.each([
    'tank',
    'healer',
    'dps',
    'flex',
    'player',
    '',
    'unknown',
    'BENCH',
    'Bench',
  ])('returns empty string for %s', (slot) => {
    expect(benchSuffix(slot)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(benchSuffix(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(benchSuffix(undefined)).toBe('');
  });
});

describe('benchSuffix — case sensitivity', () => {
  it('only matches lowercase "bench" exactly', () => {
    expect(benchSuffix('BENCH')).toBe('');
    expect(benchSuffix('Bench')).toBe('');
    expect(benchSuffix('bench')).not.toBe('');
  });
});
