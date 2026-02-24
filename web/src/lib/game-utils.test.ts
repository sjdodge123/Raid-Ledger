import { describe, it, expect } from 'vitest';
import { GENRE_MAP, getGenreLabel } from './game-utils';

describe('GENRE_MAP', () => {
  it('contains all expected IGDB genre IDs', () => {
    expect(Object.keys(GENRE_MAP).length).toBe(23);
    expect(GENRE_MAP[12]).toBe('RPG');
    expect(GENRE_MAP[36]).toBe('MOBA');
  });
});

describe('getGenreLabel', () => {
  it('returns the display name for a known genre ID', () => {
    expect(getGenreLabel(5)).toBe('Shooter');
    expect(getGenreLabel(12)).toBe('RPG');
    expect(getGenreLabel(31)).toBe('Adventure');
  });

  it('returns null for an unknown genre ID', () => {
    expect(getGenreLabel(0)).toBeNull();
    expect(getGenreLabel(999)).toBeNull();
    expect(getGenreLabel(-1)).toBeNull();
  });
});
