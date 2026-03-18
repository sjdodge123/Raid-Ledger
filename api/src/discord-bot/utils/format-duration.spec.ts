import { formatDurationMs } from './format-duration';

describe('formatDurationMs', () => {
  it('returns "0m" for zero', () => {
    expect(formatDurationMs(0)).toBe('0m');
  });

  it('returns "0m" for negative values', () => {
    expect(formatDurationMs(-5000)).toBe('0m');
  });

  it('returns minutes only when under 1 hour', () => {
    expect(formatDurationMs(45 * 60_000)).toBe('45m');
  });

  it('returns hours only when minutes are zero', () => {
    expect(formatDurationMs(2 * 3_600_000)).toBe('2h');
  });

  it('returns hours and minutes combined', () => {
    expect(formatDurationMs(2 * 3_600_000 + 30 * 60_000)).toBe('2h 30m');
  });

  it('floors partial minutes', () => {
    // 1h 59m 59.999s → 1h 59m (not rounded up)
    expect(formatDurationMs(3_600_000 + 59 * 60_000 + 59_999)).toBe('1h 59m');
  });

  it('returns "0m" for sub-minute durations', () => {
    expect(formatDurationMs(59_999)).toBe('0m');
  });

  it('returns "1m" for exactly 1 minute', () => {
    expect(formatDurationMs(60_000)).toBe('1m');
  });

  it('returns "1h" for exactly 1 hour', () => {
    expect(formatDurationMs(3_600_000)).toBe('1h');
  });
});
