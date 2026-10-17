/**
 * Adversarial tests for IGDB enrichment helpers (ROK-773).
 * Covers edge cases for query building, enrichment parsing,
 * multiplayer modes, screenshots, videos, and rating extraction.
 */
import {
  buildExternalGamesQuery,
  parseIgdbEnrichment,
} from './igdb-itad-enrich.helpers';

describe('buildExternalGamesQuery — edge cases', () => {
  it('handles Steam app ID of 0', () => {
    const query = buildExternalGamesQuery(0);

    expect(query).toContain('external_games.uid = "0"');
  });

  it('handles very large Steam app IDs', () => {
    const query = buildExternalGamesQuery(9999999);

    expect(query).toContain('external_games.uid = "9999999"');
    expect(query).toContain('limit 1');
  });

  it('always includes limit 1', () => {
    const query = buildExternalGamesQuery(12345);

    expect(query).toContain('limit 1;');
  });

  it('includes expected expanded fields', () => {
    const query = buildExternalGamesQuery(100);

    expect(query).toContain('screenshots.image_id');
    expect(query).toContain('videos.name');
    expect(query).toContain('multiplayer_modes.*');
    expect(query).toContain('external_games.*');
    expect(query).toContain('platforms.id');
    expect(query).toContain('themes.id');
  });
});

describe('parseIgdbEnrichment — edge cases', () => {
  it('handles game with only id (all optional fields missing)', () => {
    const result = parseIgdbEnrichment({ id: 1 });

    expect(result.igdbId).toBe(1);
    expect(result.coverUrl).toBeNull();
    expect(result.summary).toBeNull();
    expect(result.genres).toEqual([]);
    expect(result.themes).toEqual([]);
    expect(result.gameModes).toEqual([]);
    expect(result.platforms).toEqual([]);
    expect(result.screenshots).toEqual([]);
    expect(result.videos).toEqual([]);
    expect(result.twitchGameId).toBeNull();
    expect(result.playerCount).toBeNull();
    expect(result.crossplay).toBeNull();
    expect(result.rating).toBeNull();
    expect(result.aggregatedRating).toBeNull();
  });

  it('builds screenshot URLs correctly', () => {
    const result = parseIgdbEnrichment({
      id: 2,
      screenshots: [{ image_id: 'ss_001' }, { image_id: 'ss_002' }],
    });

    expect(result.screenshots).toHaveLength(2);
    expect(result.screenshots[0]).toContain('ss_001.jpg');
    expect(result.screenshots[1]).toContain('ss_002.jpg');
    expect(result.screenshots[0]).toContain('t_screenshot_big');
  });

  it('builds video objects correctly', () => {
    const result = parseIgdbEnrichment({
      id: 3,
      videos: [
        { name: 'Trailer 1', video_id: 'yt_abc' },
        { name: 'Gameplay', video_id: 'yt_def' },
      ],
    });

    expect(result.videos).toHaveLength(2);
    expect(result.videos[0]).toEqual({
      name: 'Trailer 1',
      videoId: 'yt_abc',
    });
  });

  it('builds cover URL with correct base and format', () => {
    const result = parseIgdbEnrichment({
      id: 4,
      cover: { image_id: 'co_xyz123' },
    });

    expect(result.coverUrl).toBe(
      'https://images.igdb.com/igdb/image/upload/t_cover_big/co_xyz123.jpg',
    );
  });

  describe('multiplayer modes', () => {
    it('returns null playerCount when multiplayer_modes is empty', () => {
      const result = parseIgdbEnrichment({
        id: 5,
        multiplayer_modes: [],
      });

      expect(result.playerCount).toBeNull();
    });

    it('extracts max from onlinemax across modes', () => {
      const result = parseIgdbEnrichment({
        id: 6,
        multiplayer_modes: [
          { onlinemax: 4, offlinemax: 2 },
          { onlinemax: 8, offlinemax: 0 },
        ],
      });

      expect(result.playerCount).toEqual({ min: 1, max: 8 });
    });

    it('extracts max from offlinemax when larger than onlinemax', () => {
      const result = parseIgdbEnrichment({
        id: 7,
        multiplayer_modes: [{ onlinemax: 2, offlinemax: 4 }],
      });

      expect(result.playerCount).toEqual({ min: 1, max: 4 });
    });

    it('returns null when all max values are 0', () => {
      const result = parseIgdbEnrichment({
        id: 8,
        multiplayer_modes: [{ onlinemax: 0, offlinemax: 0 }],
      });

      expect(result.playerCount).toBeNull();
    });

    it('handles undefined onlinemax/offlinemax', () => {
      const result = parseIgdbEnrichment({
        id: 9,
        multiplayer_modes: [{}],
      });

      expect(result.playerCount).toBeNull();
    });
  });

  describe('Twitch game ID extraction', () => {
    it('extracts twitchGameId via category field', () => {
      const result = parseIgdbEnrichment({
        id: 10,
        external_games: [{ category: 14, uid: 'twitch-123' }],
      });

      expect(result.twitchGameId).toBe('twitch-123');
    });

    it('extracts twitchGameId via external_game_source field', () => {
      const result = parseIgdbEnrichment({
        id: 11,
        external_games: [{ external_game_source: 14, uid: 'twitch-456' }],
      });

      expect(result.twitchGameId).toBe('twitch-456');
    });

    it('returns null when no Twitch external game', () => {
      const result = parseIgdbEnrichment({
        id: 12,
        external_games: [
          { category: 1, uid: '292030' }, // Steam only
        ],
      });

      expect(result.twitchGameId).toBeNull();
    });

    it('returns null when external_games is undefined', () => {
      const result = parseIgdbEnrichment({ id: 13 });

      expect(result.twitchGameId).toBeNull();
    });
  });

  it('sets crossplay to null always', () => {
    // enrichment helper always returns crossplay: null
    const result = parseIgdbEnrichment({
      id: 14,
      multiplayer_modes: [{ onlinemax: 8, platform: 6 }],
    });

    expect(result.crossplay).toBeNull();
  });

  it('preserves rating values including decimals', () => {
    const result = parseIgdbEnrichment({
      id: 15,
      rating: 92.45678,
      aggregated_rating: 88.123,
    });

    expect(result.rating).toBe(92.45678);
    expect(result.aggregatedRating).toBe(88.123);
  });
});
