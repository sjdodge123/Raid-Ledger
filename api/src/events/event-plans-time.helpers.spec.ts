import { parseAfterDate } from './event-plans-time.helpers';

describe('parseAfterDate (public time-suggestions query)', () => {
  it('parses a valid ISO date', () => {
    expect(parseAfterDate('2026-10-20T18:00:00.000Z').toISOString()).toBe(
      '2026-10-20T18:00:00.000Z',
    );
  });

  it('falls back to now for an unparseable value instead of an Invalid Date', () => {
    const before = Date.now();
    const parsed = parseAfterDate('invalid');
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('defaults to now when absent', () => {
    const before = Date.now();
    expect(parseAfterDate(undefined).getTime()).toBeGreaterThanOrEqual(before);
  });
});
