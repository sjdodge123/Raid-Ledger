/**
 * Tests for IGDB enrichment via external_games (ROK-773).
 */
import {
  buildExternalGamesQuery,
  parseIgdbEnrichment,
} from './igdb-itad-enrich.helpers';

describe('buildExternalGamesQuery', () => {
  it('builds APICALYPSE query for Steam app ID lookup', () => {
    const query = buildExternalGamesQuery(292030);

    expect(query).toContain('external_games.category = 1');
    expect(query).toContain('external_games.uid = "292030"');
    expect(query).toContain('limit 1');
    expect(query).toContain('cover.image_id');
    expect(query).toContain('genres.id');
    expect(query).toContain('summary');
  });
});

describe('parseIgdbEnrichment', () => {
  it('extracts enrichment data from IGDB API game', () => {
    const apiGame = {
      id: 1942,
      name: 'The Witcher 3',
      slug: 'the-witcher-3-wild-hunt',
      cover: { image_id: 'co_abc' },
      genres: [{ id: 12 }, { id: 31 }],
      themes: [{ id: 1 }],
      game_modes: [1],
      platforms: [{ id: 6 }],
      summary: 'An RPG adventure',
      screenshots: [{ image_id: 'ss_abc' }],
      videos: [{ name: 'Trailer', video_id: 'xyz123' }],
      rating: 92,
      aggregated_rating: 93,
      external_games: [
        { category: 1, uid: '292030' },
        { category: 14, uid: '115977' },
      ],
      multiplayer_modes: [],
    };

    const result = parseIgdbEnrichment(apiGame);

    expect(result).not.toBeNull();
    expect(result.igdbId).toBe(1942);
    expect(result.coverUrl).toContain('co_abc');
    expect(result.genres).toEqual([12, 31]);
    expect(result.summary).toBe('An RPG adventure');
    expect(result.twitchGameId).toBe('115977');
    expect(result.screenshots).toHaveLength(1);
    expect(result.rating).toBe(92);
  });

  it('returns null cover when no cover data', () => {
    const apiGame = {
      id: 100,
      name: 'No Cover Game',
      slug: 'no-cover',
    };

    const result = parseIgdbEnrichment(apiGame);

    expect(result.coverUrl).toBeNull();
    expect(result.genres).toEqual([]);
  });
});
