/**
 * Tests for game search deduplication across IGDB and ITAD sources (ROK-1008).
 *
 * These tests are written BEFORE the implementation exists.
 * They should fail with an import error until igdb-search-dedup.helpers.ts is created.
 */
import type { GameDetailDto } from '@raid-ledger/contract';
import {
  normalizeForDedup,
  deduplicateGames,
  mergeEnrichment,
} from './igdb-search-dedup.helpers';

/** Build a minimal GameDetailDto with sensible defaults. */
function makeGame(
  overrides: Partial<GameDetailDto> & { steamAppId?: number },
): GameDetailDto & { steamAppId?: number } {
  return {
    id: 0,
    igdbId: null,
    name: 'Test Game',
    slug: 'test-game',
    coverUrl: null,
    genres: [],
    summary: null,
    rating: null,
    aggregatedRating: null,
    popularity: null,
    gameModes: [],
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
    ...overrides,
  };
}

// ============================================================
// normalizeForDedup
// ============================================================

describe('normalizeForDedup', () => {
  it('lowercases names', () => {
    expect(normalizeForDedup('Slay The Spire')).toBe(
      normalizeForDedup('slay the spire'),
    );
  });

  // AC: normalizeForDedup("Slay the Spire II") equals normalizeForDedup("Slay the Spire 2")
  it('converts Roman numeral II to 2', () => {
    expect(normalizeForDedup('Slay the Spire II')).toBe(
      normalizeForDedup('Slay the Spire 2'),
    );
  });

  // AC: Roman numerals at word boundaries are normalized: III->3
  it('converts Roman numeral III to 3', () => {
    expect(normalizeForDedup('Final Fantasy III')).toBe(
      normalizeForDedup('Final Fantasy 3'),
    );
  });

  // AC: Roman numerals at word boundaries are normalized: IV->4
  it('converts Roman numeral IV to 4', () => {
    expect(normalizeForDedup('Civilization IV')).toBe(
      normalizeForDedup('Civilization 4'),
    );
  });

  // AC: Roman numerals at word boundaries are normalized: V->5
  it('converts Roman numeral V to 5', () => {
    expect(normalizeForDedup('Grand Theft Auto V')).toBe(
      normalizeForDedup('Grand Theft Auto 5'),
    );
  });

  // AC: Roman numerals at word boundaries are normalized: VI->6
  it('converts Roman numeral VI to 6', () => {
    expect(normalizeForDedup('Resident Evil VI')).toBe(
      normalizeForDedup('Resident Evil 6'),
    );
  });

  // AC: Roman numerals at word boundaries are normalized: VII->7
  it('converts Roman numeral VII to 7', () => {
    expect(normalizeForDedup('Final Fantasy VII')).toBe(
      normalizeForDedup('Final Fantasy 7'),
    );
  });

  // AC: Roman numerals at word boundaries are normalized: VIII->8
  it('converts Roman numeral VIII to 8', () => {
    expect(normalizeForDedup('Final Fantasy VIII')).toBe(
      normalizeForDedup('Final Fantasy 8'),
    );
  });

  it('only converts Roman numerals at word boundaries', () => {
    // "Vivid" contains "VI" but should not be converted
    const result = normalizeForDedup('Vivid Knight');
    expect(result).not.toContain('6');
  });

  // AC: normalizeForDedup("Game: Subtitle") equals normalizeForDedup("Game - Subtitle")
  it('strips subtitle punctuation (colons)', () => {
    expect(normalizeForDedup('Game: Subtitle')).toBe(
      normalizeForDedup('Game Subtitle'),
    );
  });

  it('strips subtitle punctuation (dashes)', () => {
    expect(normalizeForDedup('Game - Subtitle')).toBe(
      normalizeForDedup('Game Subtitle'),
    );
  });

  it('colon and dash subtitles normalize to the same value', () => {
    expect(normalizeForDedup('Game: Subtitle')).toBe(
      normalizeForDedup('Game - Subtitle'),
    );
  });

  it('collapses multiple whitespace into single space', () => {
    expect(normalizeForDedup('Game   Name')).toBe(
      normalizeForDedup('Game Name'),
    );
  });

  it('handles combined normalization (Roman numeral + subtitle)', () => {
    expect(normalizeForDedup('Slay the Spire II: Remastered')).toBe(
      normalizeForDedup('Slay the Spire 2 Remastered'),
    );
  });
});

// ============================================================
// deduplicateGames
// ============================================================

describe('deduplicateGames', () => {
  // AC: Games with matching igdbId but different slugs are deduplicated
  describe('dedup by igdbId', () => {
    it('deduplicates games sharing the same igdbId', () => {
      const itadEntry = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        igdbId: 12345,
        itadGameId: 'itad-uuid-1',
        coverUrl: null,
      });
      const igdbEntry = makeGame({
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        igdbId: 12345,
        summary: 'A great deckbuilder',
        genres: [12, 31],
      });

      const result = deduplicateGames([itadEntry, igdbEntry]);

      expect(result).toHaveLength(1);
    });
  });

  // AC: Games with matching steamAppId but different slugs are deduplicated
  describe('dedup by steamAppId', () => {
    it('deduplicates games sharing the same steamAppId', () => {
      const itadEntry = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        steamAppId: 646570,
        itadGameId: 'itad-uuid-1',
      });
      const igdbEntry = makeGame({
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        steamAppId: 646570,
        igdbId: 12345,
        summary: 'A great deckbuilder',
      });

      const result = deduplicateGames([itadEntry, igdbEntry]);

      expect(result).toHaveLength(1);
    });
  });

  // AC: Games matching via normalized name are deduplicated
  describe('dedup by normalized name', () => {
    it('deduplicates games with same normalized name', () => {
      const itadEntry = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        itadGameId: 'itad-uuid-1',
      });
      const igdbEntry = makeGame({
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        igdbId: 12345,
      });

      const result = deduplicateGames([itadEntry, igdbEntry]);

      expect(result).toHaveLength(1);
    });

    it('deduplicates games differing only in subtitle punctuation', () => {
      const colonVersion = makeGame({
        name: 'Dark Souls: Remastered',
        slug: 'dark-souls-remastered-a',
        itadGameId: 'itad-uuid-2',
      });
      const dashVersion = makeGame({
        name: 'Dark Souls - Remastered',
        slug: 'dark-souls-remastered-b',
        igdbId: 999,
      });

      const result = deduplicateGames([colonVersion, dashVersion]);

      expect(result).toHaveLength(1);
    });
  });

  // AC: When deduplicating, the ITAD entry (has itadGameId) wins
  describe('winner selection', () => {
    it('keeps the ITAD entry as winner when deduplicating by igdbId', () => {
      const itadEntry = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        igdbId: 12345,
        itadGameId: 'itad-uuid-1',
        itadBoxartUrl: 'https://itad.example.com/boxart.jpg',
      });
      const igdbEntry = makeGame({
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        igdbId: 12345,
        summary: 'A great deckbuilder',
        genres: [12, 31],
      });

      const result = deduplicateGames([igdbEntry, itadEntry]);

      expect(result).toHaveLength(1);
      expect(result[0].itadGameId).toBe('itad-uuid-1');
      expect(result[0].name).toBe('Slay the Spire 2');
    });

    it('keeps the ITAD entry as winner when deduplicating by name', () => {
      const igdbEntry = makeGame({
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        igdbId: 12345,
        summary: 'A great deckbuilder',
      });
      const itadEntry = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        itadGameId: 'itad-uuid-1',
      });

      const result = deduplicateGames([igdbEntry, itadEntry]);

      expect(result).toHaveLength(1);
      expect(result[0].itadGameId).toBe('itad-uuid-1');
    });

    it('uses first-seen when neither entry has itadGameId', () => {
      const first = makeGame({
        name: 'Game Alpha',
        slug: 'game-alpha-1',
        igdbId: 100,
        summary: 'First summary',
      });
      const second = makeGame({
        name: 'Game Alpha',
        slug: 'game-alpha-2',
        igdbId: 100,
        summary: 'Second summary',
      });

      const result = deduplicateGames([first, second]);

      expect(result).toHaveLength(1);
      expect(result[0].summary).toBe('First summary');
    });
  });

  // AC: IGDB metadata from the loser is merged into the winner
  describe('enrichment merge on dedup', () => {
    it('copies IGDB metadata from loser into winner', () => {
      const itadWinner = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        igdbId: null,
        itadGameId: 'itad-uuid-1',
        summary: null,
        genres: [],
        rating: null,
        aggregatedRating: null,
        screenshots: [],
        videos: [],
        themes: [],
        platforms: [],
        gameModes: [],
        twitchGameId: null,
        playerCount: null,
        crossplay: null,
      });
      const igdbLoser = makeGame({
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        igdbId: 12345,
        summary: 'A great deckbuilder sequel',
        genres: [12, 31],
        rating: 92.5,
        aggregatedRating: 90.0,
        screenshots: ['https://igdb.com/ss1.jpg'],
        videos: [{ name: 'Trailer', videoId: 'abc123' }],
        themes: [1, 17],
        platforms: [6, 14],
        gameModes: [1],
        twitchGameId: 'twitch-123',
        playerCount: { min: 1, max: 1 },
        crossplay: false,
      });

      const result = deduplicateGames([itadWinner, igdbLoser]);

      expect(result).toHaveLength(1);
      expect(result[0].itadGameId).toBe('itad-uuid-1');
      expect(result[0].igdbId).toBe(12345);
      expect(result[0].summary).toBe('A great deckbuilder sequel');
      expect(result[0].genres).toEqual([12, 31]);
      expect(result[0].rating).toBe(92.5);
      expect(result[0].screenshots).toEqual(['https://igdb.com/ss1.jpg']);
      expect(result[0].twitchGameId).toBe('twitch-123');
    });

    it('copies ITAD fields from loser into winner', () => {
      const igdbWinner = makeGame({
        name: 'Game Alpha',
        slug: 'game-alpha-igdb',
        igdbId: 500,
        itadGameId: null,
        itadBoxartUrl: null,
        itadTags: [],
      });
      const itadLoser = makeGame({
        name: 'Game Alpha',
        slug: 'game-alpha-itad',
        igdbId: 500,
        itadGameId: 'itad-uuid-99',
        itadBoxartUrl: 'https://itad.example.com/boxart.jpg',
        itadTags: ['rpg', 'indie'],
        itadCurrentPrice: 19.99,
        itadCurrentCut: 20,
        itadCurrentShop: 'Steam',
        itadLowestPrice: 9.99,
        itadLowestCut: 50,
      });

      // itadLoser has itadGameId so it should win
      const result = deduplicateGames([igdbWinner, itadLoser]);

      expect(result).toHaveLength(1);
      expect(result[0].itadGameId).toBe('itad-uuid-99');
      expect(result[0].itadBoxartUrl).toBe(
        'https://itad.example.com/boxart.jpg',
      );
      expect(result[0].itadTags).toEqual(['rpg', 'indie']);
      // IGDB metadata from the first entry should be preserved
      expect(result[0].igdbId).toBe(500);
    });

    it('does not overwrite winner fields that already have values', () => {
      const winner = makeGame({
        name: 'Game Beta',
        slug: 'game-beta-1',
        igdbId: 200,
        itadGameId: 'itad-uuid-beta',
        summary: 'Winner summary',
        genres: [5],
        rating: 80,
      });
      const loser = makeGame({
        name: 'Game Beta',
        slug: 'game-beta-2',
        igdbId: 200,
        summary: 'Loser summary',
        genres: [5, 10],
        rating: 95,
      });

      const result = deduplicateGames([winner, loser]);

      expect(result).toHaveLength(1);
      // Winner already had summary and rating, so they should NOT be overwritten
      expect(result[0].summary).toBe('Winner summary');
      expect(result[0].rating).toBe(80);
    });
  });

  // AC: Games with no matching igdbId, steamAppId, or normalized name are NOT falsely deduplicated
  describe('no false deduplication', () => {
    it('keeps distinct games separate', () => {
      const gameA = makeGame({
        name: 'Elden Ring',
        slug: 'elden-ring',
        igdbId: 100,
        itadGameId: 'itad-elden',
      });
      const gameB = makeGame({
        name: 'Dark Souls',
        slug: 'dark-souls',
        igdbId: 200,
        itadGameId: 'itad-dark-souls',
      });
      const gameC = makeGame({
        name: 'Hollow Knight',
        slug: 'hollow-knight',
        igdbId: 300,
      });

      const result = deduplicateGames([gameA, gameB, gameC]);

      expect(result).toHaveLength(3);
    });

    it('does not merge games with similar but different names', () => {
      const gameA = makeGame({
        name: 'Slay the Spire',
        slug: 'slay-the-spire',
        igdbId: 100,
      });
      const gameB = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        igdbId: 200,
      });

      const result = deduplicateGames([gameA, gameB]);

      expect(result).toHaveLength(2);
    });

    it('does not merge games where igdbId is null on both', () => {
      const gameA = makeGame({
        name: 'Alpha Game',
        slug: 'alpha-game',
        igdbId: null,
        itadGameId: 'itad-1',
      });
      const gameB = makeGame({
        name: 'Beta Game',
        slug: 'beta-game',
        igdbId: null,
        itadGameId: 'itad-2',
      });

      const result = deduplicateGames([gameA, gameB]);

      expect(result).toHaveLength(2);
    });
  });

  // AC: Original result order is preserved after deduplication
  describe('order preservation', () => {
    it('preserves original result order', () => {
      const first = makeGame({
        name: 'Alpha',
        slug: 'alpha',
        igdbId: 1,
      });
      const second = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        itadGameId: 'itad-slay',
      });
      const duplicate = makeGame({
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        igdbId: 999,
      });
      const third = makeGame({
        name: 'Zeta',
        slug: 'zeta',
        igdbId: 3,
      });

      const result = deduplicateGames([first, second, duplicate, third]);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Alpha');
      // The ITAD entry should win for position of the deduped pair
      expect(result[1].itadGameId).toBe('itad-slay');
      expect(result[2].name).toBe('Zeta');
    });

    it('winner occupies the earliest position of the duplicates', () => {
      const igdbFirst = makeGame({
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        igdbId: 12345,
        summary: 'IGDB summary',
      });
      const itadSecond = makeGame({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        igdbId: 12345,
        itadGameId: 'itad-uuid',
      });
      const other = makeGame({
        name: 'Other Game',
        slug: 'other-game',
        igdbId: 999,
      });

      const result = deduplicateGames([igdbFirst, itadSecond, other]);

      expect(result).toHaveLength(2);
      // ITAD winner should be at index 0 (earliest position of the pair)
      expect(result[0].itadGameId).toBe('itad-uuid');
      expect(result[1].name).toBe('Other Game');
    });
  });

  // Dedup priority: igdbId > steamAppId > normalized name
  describe('dedup priority ordering', () => {
    it('matches by igdbId even when names differ', () => {
      const gameA = makeGame({
        name: 'Completely Different Name',
        slug: 'different-name',
        igdbId: 500,
        itadGameId: 'itad-a',
      });
      const gameB = makeGame({
        name: 'Another Name Entirely',
        slug: 'another-name',
        igdbId: 500,
      });

      const result = deduplicateGames([gameA, gameB]);

      expect(result).toHaveLength(1);
      expect(result[0].itadGameId).toBe('itad-a');
    });

    it('matches by steamAppId when igdbIds differ', () => {
      const gameA = makeGame({
        name: 'Steam Game A',
        slug: 'steam-game-a',
        igdbId: 100,
        steamAppId: 12345,
        itadGameId: 'itad-steam',
      });
      const gameB = makeGame({
        name: 'Steam Game B',
        slug: 'steam-game-b',
        igdbId: 200,
        steamAppId: 12345,
      });

      const result = deduplicateGames([gameA, gameB]);

      expect(result).toHaveLength(1);
    });
  });
});

// ============================================================
// mergeEnrichment
// ============================================================

describe('mergeEnrichment', () => {
  it('copies id from donor when winner has id 0', () => {
    const winner = makeGame({ id: 0 });
    const donor = makeGame({ id: 12345 });

    mergeEnrichment(winner, donor);

    expect(winner.id).toBe(12345);
  });

  it('does not overwrite non-zero id on winner', () => {
    const winner = makeGame({ id: 100 });
    const donor = makeGame({ id: 12345 });

    mergeEnrichment(winner, donor);

    expect(winner.id).toBe(100);
  });

  it('copies igdbId from donor when winner has null', () => {
    const winner = makeGame({ igdbId: null });
    const donor = makeGame({ igdbId: 999 });

    mergeEnrichment(winner, donor);

    expect(winner.igdbId).toBe(999);
  });

  it('does not overwrite non-null igdbId on winner', () => {
    const winner = makeGame({ igdbId: 100 });
    const donor = makeGame({ igdbId: 999 });

    mergeEnrichment(winner, donor);

    expect(winner.igdbId).toBe(100);
  });

  it('copies genres from donor when winner has empty array', () => {
    const winner = makeGame({ genres: [] });
    const donor = makeGame({ genres: [12, 31] });

    mergeEnrichment(winner, donor);

    expect(winner.genres).toEqual([12, 31]);
  });

  it('does not overwrite non-empty genres on winner', () => {
    const winner = makeGame({ genres: [5] });
    const donor = makeGame({ genres: [12, 31] });

    mergeEnrichment(winner, donor);

    expect(winner.genres).toEqual([5]);
  });

  it('copies summary from donor when winner has null', () => {
    const winner = makeGame({ summary: null });
    const donor = makeGame({ summary: 'A great game' });

    mergeEnrichment(winner, donor);

    expect(winner.summary).toBe('A great game');
  });

  it('copies rating from donor when winner has null', () => {
    const winner = makeGame({ rating: null });
    const donor = makeGame({ rating: 85.5 });

    mergeEnrichment(winner, donor);

    expect(winner.rating).toBe(85.5);
  });

  it('copies screenshots from donor when winner has empty array', () => {
    const winner = makeGame({ screenshots: [] });
    const donor = makeGame({ screenshots: ['https://img.com/ss1.jpg'] });

    mergeEnrichment(winner, donor);

    expect(winner.screenshots).toEqual(['https://img.com/ss1.jpg']);
  });

  it('copies itadGameId from donor when winner has null/undefined', () => {
    const winner = makeGame({ itadGameId: null });
    const donor = makeGame({ itadGameId: 'itad-uuid-donor' });

    mergeEnrichment(winner, donor);

    expect(winner.itadGameId).toBe('itad-uuid-donor');
  });

  it('copies itadBoxartUrl from donor when winner has null', () => {
    const winner = makeGame({ itadBoxartUrl: null });
    const donor = makeGame({
      itadBoxartUrl: 'https://itad.example.com/boxart.jpg',
    });

    mergeEnrichment(winner, donor);

    expect(winner.itadBoxartUrl).toBe('https://itad.example.com/boxart.jpg');
  });

  it('copies itadTags from donor when winner has empty array', () => {
    const winner = makeGame({ itadTags: [] });
    const donor = makeGame({ itadTags: ['rpg', 'indie'] });

    mergeEnrichment(winner, donor);

    expect(winner.itadTags).toEqual(['rpg', 'indie']);
  });

  it('copies ITAD pricing from donor when winner fields are null', () => {
    const winner = makeGame({
      itadCurrentPrice: null,
      itadCurrentCut: null,
      itadCurrentShop: null,
      itadLowestPrice: null,
      itadLowestCut: null,
    });
    const donor = makeGame({
      itadCurrentPrice: 19.99,
      itadCurrentCut: 20,
      itadCurrentShop: 'Steam',
      itadLowestPrice: 9.99,
      itadLowestCut: 50,
    });

    mergeEnrichment(winner, donor);

    expect(winner.itadCurrentPrice).toBe(19.99);
    expect(winner.itadCurrentCut).toBe(20);
    expect(winner.itadCurrentShop).toBe('Steam');
    expect(winner.itadLowestPrice).toBe(9.99);
    expect(winner.itadLowestCut).toBe(50);
  });

  it('copies videos from donor when winner has empty array', () => {
    const winner = makeGame({ videos: [] });
    const donor = makeGame({
      videos: [{ name: 'Trailer', videoId: 'xyz' }],
    });

    mergeEnrichment(winner, donor);

    expect(winner.videos).toEqual([{ name: 'Trailer', videoId: 'xyz' }]);
  });

  it('copies twitchGameId from donor when winner has null', () => {
    const winner = makeGame({ twitchGameId: null });
    const donor = makeGame({ twitchGameId: 'twitch-456' });

    mergeEnrichment(winner, donor);

    expect(winner.twitchGameId).toBe('twitch-456');
  });

  it('copies playerCount from donor when winner has null', () => {
    const winner = makeGame({ playerCount: null });
    const donor = makeGame({ playerCount: { min: 1, max: 4 } });

    mergeEnrichment(winner, donor);

    expect(winner.playerCount).toEqual({ min: 1, max: 4 });
  });

  it('copies crossplay from donor when winner has null', () => {
    const winner = makeGame({ crossplay: null });
    const donor = makeGame({ crossplay: true });

    mergeEnrichment(winner, donor);

    expect(winner.crossplay).toBe(true);
  });
});
