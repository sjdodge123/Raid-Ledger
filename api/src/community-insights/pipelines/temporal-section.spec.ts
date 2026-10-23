/**
 * ROK-1936 — the heatmap timezone resolver: a bad or missing community
 * default timezone must fall back to UTC, never break the refresh.
 */
import { resolveHeatmapTimezone } from './temporal-section';

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
  ])('falls back to UTC for %s', (_label, raw) => {
    expect(resolveHeatmapTimezone(raw)).toBe('UTC');
  });
});
