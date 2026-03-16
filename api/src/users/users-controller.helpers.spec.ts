/**
 * Unit tests for users-controller.helpers (ROK-821).
 * Tests parseSources, parsePlaytimeMin, parsePlayHistory helpers.
 */
import { BadRequestException } from '@nestjs/common';
import {
  parsePagination,
  validateSource,
  parseSources,
  parsePlaytimeMin,
  parsePlayHistory,
  resolveSources,
  buildPaginatedMeta,
} from './users-controller.helpers';

describe('parsePagination', () => {
  it('returns defaults when no params', () => {
    expect(parsePagination()).toEqual({ page: 1, limit: 20 });
  });

  it('parses valid page and limit', () => {
    expect(parsePagination('3', '10')).toEqual({ page: 3, limit: 10 });
  });

  it('clamps limit to max 50', () => {
    expect(parsePagination('1', '100')).toEqual({ page: 1, limit: 50 });
  });
});

describe('validateSource', () => {
  it('does not throw for valid source', () => {
    expect(() => validateSource('manual', ['manual', 'discord'])).not.toThrow();
  });

  it('throws for invalid source', () => {
    expect(() => validateSource('invalid', ['manual'])).toThrow(
      BadRequestException,
    );
  });

  it('does not throw for undefined', () => {
    expect(() => validateSource(undefined, ['manual'])).not.toThrow();
  });
});

describe('parseSources', () => {
  it('returns empty array when no input', () => {
    expect(parseSources()).toEqual([]);
    expect(parseSources(undefined)).toEqual([]);
    expect(parseSources('')).toEqual([]);
  });

  it('parses a single valid source', () => {
    expect(parseSources('manual')).toEqual(['manual']);
  });

  it('parses comma-separated valid sources', () => {
    expect(parseSources('manual,discord')).toEqual(['manual', 'discord']);
  });

  it('parses all four valid sources', () => {
    const result = parseSources('manual,discord,steam_library,steam_wishlist');
    expect(result).toEqual([
      'manual',
      'discord',
      'steam_library',
      'steam_wishlist',
    ]);
  });

  it('ignores invalid source values silently', () => {
    expect(parseSources('manual,invalid,discord')).toEqual([
      'manual',
      'discord',
    ]);
  });

  it('returns empty array when all values are invalid', () => {
    expect(parseSources('foo,bar')).toEqual([]);
  });

  it('trims whitespace from source values', () => {
    expect(parseSources(' manual , discord ')).toEqual(['manual', 'discord']);
  });
});

describe('parsePlaytimeMin', () => {
  it('returns undefined when no input', () => {
    expect(parsePlaytimeMin()).toBeUndefined();
    expect(parsePlaytimeMin(undefined)).toBeUndefined();
    expect(parsePlaytimeMin('')).toBeUndefined();
  });

  it('parses a valid positive integer', () => {
    expect(parsePlaytimeMin('120')).toBe(120);
  });

  it('returns undefined for zero (no filter)', () => {
    expect(parsePlaytimeMin('0')).toBeUndefined();
  });

  it('returns undefined for negative values', () => {
    expect(parsePlaytimeMin('-10')).toBeUndefined();
  });

  it('returns undefined for non-numeric strings', () => {
    expect(parsePlaytimeMin('abc')).toBeUndefined();
  });

  it('floors decimal values', () => {
    expect(parsePlaytimeMin('10.7')).toBe(10);
  });
});

describe('parsePlayHistory', () => {
  it('returns undefined when no input', () => {
    expect(parsePlayHistory()).toBeUndefined();
    expect(parsePlayHistory(undefined)).toBeUndefined();
    expect(parsePlayHistory('')).toBeUndefined();
  });

  it('returns valid play history value: played_recently', () => {
    expect(parsePlayHistory('played_recently')).toBe('played_recently');
  });

  it('returns valid play history value: played_ever', () => {
    expect(parsePlayHistory('played_ever')).toBe('played_ever');
  });

  it('returns valid play history value: any', () => {
    expect(parsePlayHistory('any')).toBe('any');
  });

  it('returns undefined for invalid values', () => {
    expect(parsePlayHistory('invalid')).toBeUndefined();
  });

  it('returns undefined for "any" (treated as no filter)', () => {
    // "any" means no play history filter
    expect(parsePlayHistory('any')).toBe('any');
  });
});

describe('resolveSources', () => {
  it('prefers sourcesStr over single source', () => {
    expect(resolveSources('manual', 'discord,steam_library')).toEqual([
      'discord',
      'steam_library',
    ]);
  });

  it('falls back to single source when sourcesStr is undefined', () => {
    expect(resolveSources('manual')).toEqual(['manual']);
  });

  it('returns empty array when both are undefined', () => {
    expect(resolveSources()).toEqual([]);
  });
});

describe('buildPaginatedMeta', () => {
  it('returns hasMore true when more items exist', () => {
    expect(buildPaginatedMeta(50, 1, 20)).toEqual({
      total: 50,
      page: 1,
      limit: 20,
      hasMore: true,
    });
  });

  it('returns hasMore false when all items shown', () => {
    expect(buildPaginatedMeta(10, 1, 20)).toEqual({
      total: 10,
      page: 1,
      limit: 20,
      hasMore: false,
    });
  });
});
