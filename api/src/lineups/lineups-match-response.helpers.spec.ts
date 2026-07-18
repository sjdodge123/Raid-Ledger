/**
 * Unit tests for lineups-match-response helpers (ROK-1274).
 * Exercises the pure `mapCarriedForwardEntries` mapper that produces the
 * decided-view chip strip payload from `community_lineup_entries` rows.
 */
import {
  mapCarriedForwardEntries,
  mapMatchToDto,
  resolvePlayerCap,
} from './lineups-match-response.helpers';
import type { findMatchesByLineup } from './lineups-match-query.helpers';

const NOW = new Date('2026-05-12T00:00:00Z');

type MatchRow = Awaited<ReturnType<typeof findMatchesByLineup>>[0];

function makeMatchRow(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 1,
    lineupId: 1,
    gameId: 42,
    status: 'scheduling',
    thresholdMet: true,
    voteCount: 5,
    votePercentage: '60',
    fitType: 'normal',
    linkedEventId: null,
    createdAt: NOW,
    updatedAt: NOW,
    gameName: 'Valheim',
    gameCoverUrl: null,
    gamePlayerCount: null,
    gameCooptimusOnlineMax: null,
    ...overrides,
  };
}

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

describe('resolvePlayerCap — ROK-1397 precedence (ROK-1411)', () => {
  it('prefers cooptimusOnlineMax over player_count.max when it is > 0', () => {
    expect(resolvePlayerCap(6, 10)).toBe(6);
  });

  it('falls back to player_count.max when cooptimusOnlineMax is 0 (PvP/MMO zero-caveat)', () => {
    // A ZERO cooptimus value is a "no online co-op" capability claim, not a
    // capacity of zero — player_count stays authoritative (games.ts:152-159).
    expect(resolvePlayerCap(0, 10)).toBe(10);
  });

  it('uses cooptimusOnlineMax when player_count is null', () => {
    expect(resolvePlayerCap(6, null)).toBe(6);
  });

  it('returns null when both sources are null', () => {
    expect(resolvePlayerCap(null, null)).toBeNull();
  });
});

describe('mapMatchToDto — playerCap population (ROK-1411)', () => {
  it('sets playerCap to null when the game has no cap sources', () => {
    const dto = mapMatchToDto(
      makeMatchRow({ gamePlayerCount: null, gameCooptimusOnlineMax: null }),
      [],
    );

    expect(dto.playerCap).toBeNull();
  });

  it('sets playerCap to the game player_count max when cooptimus is absent', () => {
    const dto = mapMatchToDto(
      makeMatchRow({
        gamePlayerCount: { min: 1, max: 10 },
        gameCooptimusOnlineMax: null,
      }),
      [],
    );

    expect(dto.playerCap).toBe(10);
  });

  it('sets playerCap from cooptimusOnlineMax when it wins the precedence', () => {
    const dto = mapMatchToDto(
      makeMatchRow({
        gamePlayerCount: { min: 1, max: 10 },
        gameCooptimusOnlineMax: 4,
      }),
      [],
    );

    expect(dto.playerCap).toBe(4);
  });
});
