/**
 * Tests for ITAD + IGDB merge logic (ROK-773).
 */
import {
  mergeItadWithIgdb,
  buildItadOnlyDetail,
  type ItadSearchGame,
  type IgdbEnrichedData,
} from './igdb-itad-merge.helpers';

const SAMPLE_ITAD_GAME: ItadSearchGame = {
  id: 'uuid-witcher3',
  slug: 'witcher-iii-wild-hunt',
  title: 'The Witcher 3: Wild Hunt',
  type: 'game',
  mature: false,
  assets: { boxart: 'https://itad.example.com/boxart.jpg' },
  tags: ['rpg', 'open-world', 'story-rich'],
  releaseDate: '2015-05-19',
  steamAppId: 292030,
};

const SAMPLE_IGDB_DATA: IgdbEnrichedData = {
  igdbId: 1942,
  coverUrl: 'https://images.igdb.com/cover.jpg',
  summary: 'An open-world RPG',
  genres: [12, 31],
  themes: [1, 17],
  gameModes: [1],
  platforms: [6, 14, 48],
  screenshots: ['https://images.igdb.com/ss1.jpg'],
  videos: [{ name: 'Trailer', videoId: 'abc123' }],
  twitchGameId: '112233',
  playerCount: { min: 1, max: 1 },
  crossplay: null,
  rating: 92.5,
  aggregatedRating: 93.1,
};

describe('mergeItadWithIgdb', () => {
  it('enriches ITAD game with IGDB data', () => {
    const result = mergeItadWithIgdb(SAMPLE_ITAD_GAME, SAMPLE_IGDB_DATA);

    expect(result.igdbId).toBe(1942);
    expect(result.coverUrl).toBe('https://images.igdb.com/cover.jpg');
    expect(result.itadBoxartUrl).toBe('https://itad.example.com/boxart.jpg');
    expect(result.summary).toBe('An open-world RPG');
    expect(result.genres).toEqual([12, 31]);
    expect(result.screenshots).toEqual(['https://images.igdb.com/ss1.jpg']);
    expect(result.twitchGameId).toBe('112233');
    expect(result.itadGameId).toBe('uuid-witcher3');
    expect(result.itadTags).toEqual(['rpg', 'open-world', 'story-rich']);
  });

  it('uses ITAD boxart as coverUrl when IGDB has no cover', () => {
    const igdbNoCover = { ...SAMPLE_IGDB_DATA, coverUrl: null };
    const result = mergeItadWithIgdb(SAMPLE_ITAD_GAME, igdbNoCover);

    expect(result.coverUrl).toBe('https://itad.example.com/boxart.jpg');
    expect(result.itadBoxartUrl).toBe('https://itad.example.com/boxart.jpg');
  });

  it('preserves ITAD release date', () => {
    const result = mergeItadWithIgdb(SAMPLE_ITAD_GAME, SAMPLE_IGDB_DATA);

    expect(result.firstReleaseDate).toBe('2015-05-19T00:00:00.000Z');
  });
});

describe('buildItadOnlyDetail', () => {
  it('creates a GameDetailDto from ITAD data only', () => {
    const result = buildItadOnlyDetail(SAMPLE_ITAD_GAME);

    expect(result.igdbId).toBeNull();
    expect(result.name).toBe('The Witcher 3: Wild Hunt');
    expect(result.slug).toBe('witcher-iii-wild-hunt');
    expect(result.coverUrl).toBe('https://itad.example.com/boxart.jpg');
    expect(result.itadBoxartUrl).toBe('https://itad.example.com/boxart.jpg');
    expect(result.itadGameId).toBe('uuid-witcher3');
    expect(result.itadTags).toEqual(['rpg', 'open-world', 'story-rich']);
    expect(result.summary).toBeNull();
    expect(result.genres).toEqual([]);
    expect(result.screenshots).toEqual([]);
  });

  it('handles missing assets gracefully', () => {
    const noAssets = { ...SAMPLE_ITAD_GAME, assets: undefined };
    const result = buildItadOnlyDetail(noAssets);

    expect(result.coverUrl).toBeNull();
    expect(result.itadBoxartUrl).toBeNull();
  });

  it('handles missing tags gracefully', () => {
    const noTags = { ...SAMPLE_ITAD_GAME, tags: undefined };
    const result = buildItadOnlyDetail(noTags);

    expect(result.itadTags).toEqual([]);
  });
});
