import { parseAfterDate } from './event-plans-time.helpers';

describe('parseAfterDate (public time-suggestions query)', () => {
  it('parses a valid ISO date within a year of now', () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(parseAfterDate(soon).toISOString()).toBe(soon);
  });

  it.each(['+275760-09-13', '-271821-04-20', '9999-12-31', '1970-01-01'])(
    'falls back to now for an extreme date (%s) that would overflow the occurrence loop',
    (value) => {
      const before = Date.now();
      const parsed = parseAfterDate(value);
      expect(parsed.getTime()).toBeGreaterThanOrEqual(before);
      expect(parsed.getTime()).toBeLessThan(before + 60_000);
    },
  );

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
