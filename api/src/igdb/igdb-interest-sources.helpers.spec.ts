/**
 * Unit tests for per-user interest source rules (ROK-1796).
 */
import {
  USER_HEART_SOURCES,
  toDtoSource,
} from './igdb-interest-sources.helpers';
import { HEART_SOURCES } from './igdb-interest.helpers';

describe('toDtoSource', () => {
  it.each([
    ['manual', 'manual'],
    ['discord', 'discord'],
    ['poll', 'poll'],
    ['steam', 'steam'],
    ['steam_library', 'steam'],
    ['steam_wishlist', 'steam'],
  ])('maps %s to %s', (stored, expected) => {
    expect(toDtoSource(stored)).toBe(expected);
  });

  it('returns undefined for null and unknown sources', () => {
    expect(toDtoSource(null)).toBeUndefined();
    expect(toDtoSource('mystery')).toBeUndefined();
  });
});

describe('USER_HEART_SOURCES', () => {
  it('is HEART_SOURCES plus the Steam sync sources', () => {
    expect(USER_HEART_SOURCES).toEqual([
      ...HEART_SOURCES,
      'steam_library',
      'steam_wishlist',
    ]);
  });
});
