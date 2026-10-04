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

  it('passes through a Postgres short "+00" timestamptz offset', () => {
    const result = parseTimestampUtc('2026-10-02 12:00:00+00');
    expect(result.getTime()).toBe(Date.UTC(2026, 9, 2, 12, 0, 0));
    expect(result.toISOString()).toBe('2026-10-02T12:00:00.000Z');
  });

  it('passes through a Postgres short "-04" offset with fractional seconds', () => {
    const result = parseTimestampUtc('2026-10-02 12:00:00.5-04');
    expect(result.getTime()).toBe(Date.UTC(2026, 9, 2, 16, 0, 0, 500));
    expect(result.toISOString()).toBe('2026-10-02T16:00:00.500Z');
  });

  it('reads a bare date as UTC midnight', () => {
    const result = parseTimestampUtc('2026-10-02');
    expect(result.getTime()).toBe(Date.UTC(2026, 9, 2));
    expect(result.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('returns a Date instance as-is', () => {
    const input = new Date('2026-06-18T14:30:00.000Z');
    const result = parseTimestampUtc(input);
    expect(result).toBe(input);
  });
});
