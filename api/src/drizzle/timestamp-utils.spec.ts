import { parseTimestampUtc } from './timestamp-utils';

describe('parseTimestampUtc', () => {
  it('interprets a naïve space-separated string as UTC', () => {
    const result = parseTimestampUtc('2026-06-18 14:30:00.000');
    expect(result.toISOString()).toBe('2026-06-18T14:30:00.000Z');
  });

  it('passes through a Z-suffixed string unchanged', () => {
    const result = parseTimestampUtc('2026-06-18T14:30:00.000Z');
    expect(result.toISOString()).toBe('2026-06-18T14:30:00.000Z');
  });

  it('passes through a +00:00 offset string', () => {
    const result = parseTimestampUtc('2026-06-18T14:30:00.000+00:00');
    expect(result.toISOString()).toBe('2026-06-18T14:30:00.000Z');
  });

  it('passes through a -05:00 offset string', () => {
    const result = parseTimestampUtc('2026-06-18T14:30:00.000-05:00');
    expect(result.toISOString()).toBe('2026-06-18T19:30:00.000Z');
  });

  it('returns a Date instance as-is', () => {
    const input = new Date('2026-06-18T14:30:00.000Z');
    const result = parseTimestampUtc(input);
    expect(result).toBe(input);
  });
});
