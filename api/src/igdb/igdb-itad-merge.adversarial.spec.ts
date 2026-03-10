/**
 * Adversarial tests for ITAD + IGDB merge helpers (ROK-773).
 * Covers cover fallback chain, release date parsing edge cases,
 * missing/null fields, and ITAD-only vs enriched comparison.
 */
import {
  mergeItadWithIgdb,
  buildItadOnlyDetail,
  type ItadSearchGame,
  type IgdbEnrichedData,
} from './igdb-itad-merge.helpers';

function makeItad(
  overrides: Partial<ItadSearchGame> = {},
): ItadSearchGame {
  return {
    id: 'uuid-test',
    slug: 'test-game',
    title: 'Test Game',
    type: 'game',
    mature: false,
    ...overrides,
  };
}

function makeIgdb(
  overrides: Partial<IgdbEnrichedData> = {},
): IgdbEnrichedData {
  return {
    igdbId: 999,
    coverUrl: 'https://igdb.com/cover.jpg',
    summary: 'A test game',
    genres: [12],
    themes: [1],
    gameModes: [1],
    platforms: [6],
    screenshots: [],
    videos: [],
    twitchGameId: null,
    playerCount: null,
    crossplay: null,
    rating: 80,
    aggregatedRating: 85,
    ...overrides,
  };
}

describe('mergeItadWithIgdb — cover fallback chain', () => {
  it('uses IGDB cover when both IGDB and ITAD have covers', () => {
    const itad = makeItad({
      assets: { boxart: 'https://itad.example.com/box.jpg' },
    });
    const igdb = makeIgdb({ coverUrl: 'https://igdb.com/cover.jpg' });

    const result = mergeItadWithIgdb(itad, igdb);

    expect(result.coverUrl).toBe('https://igdb.com/cover.jpg');
    expect(result.itadBoxartUrl).toBe('https://itad.example.com/box.jpg');
  });

  it('falls back to ITAD boxart when IGDB cover is null', () => {
    const itad = makeItad({
      assets: { boxart: 'https://itad.example.com/box.jpg' },
    });
    const igdb = makeIgdb({ coverUrl: null });

    const result = mergeItadWithIgdb(itad, igdb);

    expect(result.coverUrl).toBe('https://itad.example.com/box.jpg');
  });

  it('returns null coverUrl when neither IGDB nor ITAD has a cover', () => {
    const itad = makeItad({ assets: undefined });
    const igdb = makeIgdb({ coverUrl: null });

    const result = mergeItadWithIgdb(itad, igdb);

    expect(result.coverUrl).toBeNull();
    expect(result.itadBoxartUrl).toBeNull();
  });

  it('returns null coverUrl when ITAD assets exist but boxart is undefined', () => {
    const itad = makeItad({ assets: {} });
    const igdb = makeIgdb({ coverUrl: null });

    const result = mergeItadWithIgdb(itad, igdb);

    expect(result.coverUrl).toBeNull();
    expect(result.itadBoxartUrl).toBeNull();
  });
});

describe('mergeItadWithIgdb — IGDB data propagation', () => {
  it('propagates all IGDB media fields', () => {
    const igdb = makeIgdb({
      screenshots: ['https://igdb.com/ss1.jpg', 'https://igdb.com/ss2.jpg'],
      videos: [
        { name: 'Trailer', videoId: 'abc' },
        { name: 'Gameplay', videoId: 'def' },
      ],
    });
    const result = mergeItadWithIgdb(makeItad(), igdb);

    expect(result.screenshots).toHaveLength(2);
    expect(result.videos).toHaveLength(2);
    expect(result.videos[0].videoId).toBe('abc');
  });

  it('propagates IGDB player count and crossplay', () => {
    const igdb = makeIgdb({
      playerCount: { min: 1, max: 64 },
      crossplay: true,
    });
    const result = mergeItadWithIgdb(makeItad(), igdb);

    expect(result.playerCount).toEqual({ min: 1, max: 64 });
    expect(result.crossplay).toBe(true);
  });

  it('preserves ITAD base fields even when IGDB enriches', () => {
    const itad = makeItad({
      id: 'itad-uuid',
      tags: ['rpg', 'indie'],
      releaseDate: '2024-06-15',
    });
    const result = mergeItadWithIgdb(itad, makeIgdb());

    expect(result.itadGameId).toBe('itad-uuid');
    expect(result.itadTags).toEqual(['rpg', 'indie']);
    expect(result.slug).toBe('test-game');
    expect(result.name).toBe('Test Game');
  });

  it('sets id to 0 for search results (not yet persisted)', () => {
    const result = mergeItadWithIgdb(makeItad(), makeIgdb());

    expect(result.id).toBe(0);
  });
});

describe('buildItadOnlyDetail — edge cases', () => {
  it('sets all IGDB-specific fields to null/empty', () => {
    const result = buildItadOnlyDetail(makeItad());

    expect(result.igdbId).toBeNull();
    expect(result.summary).toBeNull();
    expect(result.rating).toBeNull();
    expect(result.aggregatedRating).toBeNull();
    expect(result.playerCount).toBeNull();
    expect(result.twitchGameId).toBeNull();
    expect(result.crossplay).toBeNull();
    expect(result.genres).toEqual([]);
    expect(result.themes).toEqual([]);
    expect(result.gameModes).toEqual([]);
    expect(result.platforms).toEqual([]);
    expect(result.screenshots).toEqual([]);
    expect(result.videos).toEqual([]);
  });

  it('uses ITAD boxart as coverUrl', () => {
    const itad = makeItad({
      assets: { boxart: 'https://itad.example.com/box.jpg' },
    });
    const result = buildItadOnlyDetail(itad);

    expect(result.coverUrl).toBe('https://itad.example.com/box.jpg');
    expect(result.itadBoxartUrl).toBe('https://itad.example.com/box.jpg');
  });

  it('returns null coverUrl when no assets', () => {
    const result = buildItadOnlyDetail(makeItad({ assets: undefined }));

    expect(result.coverUrl).toBeNull();
  });

  it('returns null coverUrl when assets has no boxart', () => {
    const result = buildItadOnlyDetail(makeItad({ assets: {} }));

    expect(result.coverUrl).toBeNull();
  });

  it('sets popularity to null', () => {
    const result = buildItadOnlyDetail(makeItad());

    expect(result.popularity).toBeNull();
  });
});

describe('release date parsing', () => {
  it('parses a valid ISO date string', () => {
    const result = buildItadOnlyDetail(
      makeItad({ releaseDate: '2024-01-15' }),
    );

    expect(result.firstReleaseDate).toBe('2024-01-15T00:00:00.000Z');
  });

  it('returns null for undefined release date', () => {
    const result = buildItadOnlyDetail(
      makeItad({ releaseDate: undefined }),
    );

    expect(result.firstReleaseDate).toBeNull();
  });

  it('returns null for invalid date string', () => {
    const result = buildItadOnlyDetail(
      makeItad({ releaseDate: 'not-a-date' }),
    );

    expect(result.firstReleaseDate).toBeNull();
  });

  it('returns null for empty string release date', () => {
    const result = buildItadOnlyDetail(makeItad({ releaseDate: '' }));

    expect(result.firstReleaseDate).toBeNull();
  });

  it('parses date with time component', () => {
    const result = buildItadOnlyDetail(
      makeItad({ releaseDate: '2023-12-07T10:30:00Z' }),
    );

    expect(result.firstReleaseDate).toBe('2023-12-07T10:30:00.000Z');
  });
});

describe('ITAD-only vs enriched results comparison', () => {
  it('ITAD-only result has same shape as enriched result', () => {
    const itad = makeItad({
      id: 'test',
      assets: { boxart: 'https://itad.example.com/box.jpg' },
      tags: ['rpg'],
      releaseDate: '2024-01-01',
    });

    const itadOnly = buildItadOnlyDetail(itad);
    const enriched = mergeItadWithIgdb(itad, makeIgdb());

    // Both have same base fields
    expect(itadOnly.name).toBe(enriched.name);
    expect(itadOnly.slug).toBe(enriched.slug);
    expect(itadOnly.itadGameId).toBe(enriched.itadGameId);
    expect(itadOnly.itadTags).toEqual(enriched.itadTags);
    expect(itadOnly.itadBoxartUrl).toBe(enriched.itadBoxartUrl);
    expect(itadOnly.id).toBe(enriched.id);

    // Both have the same property keys
    const itadKeys = Object.keys(itadOnly).sort();
    const enrichedKeys = Object.keys(enriched).sort();
    expect(itadKeys).toEqual(enrichedKeys);
  });

  it('enriched result has IGDB data where ITAD-only has null/empty', () => {
    const itad = makeItad();
    const igdb = makeIgdb({
      igdbId: 42,
      summary: 'Great game',
      rating: 95,
    });

    const itadOnly = buildItadOnlyDetail(itad);
    const enriched = mergeItadWithIgdb(itad, igdb);

    // ITAD-only has null, enriched has values
    expect(itadOnly.igdbId).toBeNull();
    expect(enriched.igdbId).toBe(42);
    expect(itadOnly.summary).toBeNull();
    expect(enriched.summary).toBe('Great game');
    expect(itadOnly.rating).toBeNull();
    expect(enriched.rating).toBe(95);
  });
});
