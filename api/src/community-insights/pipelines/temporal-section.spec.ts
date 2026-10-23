/**
 * ROK-1936 — the heatmap timezone resolver: a bad or missing community
 * default timezone must fall back to UTC, never break the refresh.
 */
import { Logger } from '@nestjs/common';
import {
  buildTemporalSection,
  resolveHeatmapTimezone,
} from './temporal-section';

type Db = Parameters<typeof buildTemporalSection>[0];

/** A db whose `execute` is the given mock — the section only calls execute. */
function mockDb(execute: jest.Mock): Db {
  return { execute } as unknown as Db;
}

describe('resolveHeatmapTimezone (ROK-1936)', () => {
  it('keeps a valid IANA zone', () => {
    expect(resolveHeatmapTimezone('America/New_York')).toBe('America/New_York');
  });

  it('trims surrounding whitespace from a valid zone', () => {
    expect(resolveHeatmapTimezone('  Europe/Berlin ')).toBe('Europe/Berlin');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['unknown zone', 'Not/AZone'],
    ['SQL-ish junk', "UTC'; DROP TABLE users; --"],
    // Postgres reads a numeric zone as POSIX (sign flipped) → 10h off.
    ['positive offset string', '+05:00'],
    ['negative offset string', '-03:00'],
  ])('falls back to UTC for %s', (_label, raw) => {
    expect(resolveHeatmapTimezone(raw)).toBe('UTC');
  });

  it('canonicalises the case of a valid IANA zone', () => {
    expect(resolveHeatmapTimezone('america/new_york')).toBe('America/New_York');
  });

  it('accepts an Etc/GMT±N name (contains a slash)', () => {
    expect(resolveHeatmapTimezone('Etc/GMT+5')).toBe('Etc/GMT+5');
  });

  it('keeps UTC itself', () => {
    expect(resolveHeatmapTimezone('UTC')).toBe('UTC');
  });
});

describe('buildTemporalSection timezone fallback (ROK-1936)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('retries once in UTC when the zone query fails, and reports UTC', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error('time zone "Foo/Bar" not recognized'))
      .mockResolvedValueOnce([{ weekday: 6, hour: 21, activity: 3 }]);
    const out = await buildTemporalSection(
      mockDb(execute),
      '2026-10-23',
      'America/New_York',
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(out.timezone).toBe('UTC');
    expect(out.heatmap).toContainEqual({ weekday: 6, hour: 21, activity: 3 });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('America/New_York'),
    );
  });

  it('does not retry when the UTC query itself fails', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(
      buildTemporalSection(mockDb(execute), '2026-10-23', null),
    ).rejects.toThrow('db down');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps the community zone when its query succeeds', async () => {
    const execute = jest.fn().mockResolvedValue([]);
    const out = await buildTemporalSection(
      mockDb(execute),
      '2026-10-23',
      'Europe/Berlin',
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out.timezone).toBe('Europe/Berlin');
  });
});
