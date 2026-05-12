/**
 * Unit tests for lineups-match-response helpers (ROK-1274).
 * Exercises the pure `mapCarriedForwardEntries` mapper that produces the
 * decided-view chip strip payload from `community_lineup_entries` rows.
 */
import { mapCarriedForwardEntries } from './lineups-match-response.helpers';

const NOW = new Date('2026-05-12T00:00:00Z');

function makeEntry(overrides: {
  id: number;
  gameId: number;
  carriedOverFrom: number | null;
  gameName?: string;
  gameCoverUrl?: string | null;
  nominatedById?: number;
  nominatedByName?: string;
}) {
  return {
    id: overrides.id,
    gameId: overrides.gameId,
    gameName: overrides.gameName ?? `Game ${overrides.gameId}`,
    gameCoverUrl: overrides.gameCoverUrl ?? null,
    nominatedById: overrides.nominatedById ?? 99,
    nominatedByName: overrides.nominatedByName ?? 'Nominator',
    note: null as string | null,
    carriedOverFrom: overrides.carriedOverFrom,
    createdAt: NOW,
    playerCount: null as { min: number; max: number } | null,
  };
}

describe('mapCarriedForwardEntries', () => {
  it('returns [] when no entry has a carriedOverFrom back-reference', () => {
    const entries = [
      makeEntry({ id: 1, gameId: 10, carriedOverFrom: null }),
      makeEntry({ id: 2, gameId: 20, carriedOverFrom: null }),
    ];

    expect(mapCarriedForwardEntries(entries, new Map())).toEqual([]);
  });

  it('returns [] when entry list is empty', () => {
    expect(mapCarriedForwardEntries([], new Map())).toEqual([]);
  });

  it('maps only carried-over entries to the contract shape', () => {
    const entries = [
      makeEntry({
        id: 1,
        gameId: 10,
        carriedOverFrom: 7,
        gameName: 'Carried Game',
        gameCoverUrl: 'https://example.com/cover.jpg',
        nominatedById: 42,
        nominatedByName: 'OG Nominator',
      }),
      makeEntry({ id: 2, gameId: 20, carriedOverFrom: null }),
    ];
    const voteMap = new Map<number, number>([
      [10, 4],
      [20, 9],
    ]);

    const result = mapCarriedForwardEntries(entries, voteMap);

    expect(result).toEqual([
      {
        gameId: 10,
        gameName: 'Carried Game',
        gameCoverUrl: 'https://example.com/cover.jpg',
        voteCount: 4,
        nominatedBy: { id: 42, displayName: 'OG Nominator' },
      },
    ]);
  });

  it('defaults voteCount to 0 when the game has no votes yet', () => {
    const entries = [makeEntry({ id: 1, gameId: 10, carriedOverFrom: 7 })];

    const result = mapCarriedForwardEntries(entries, new Map());

    expect(result).toHaveLength(1);
    expect(result[0].voteCount).toBe(0);
  });
});
