/**
 * Unit tests for the weekly-digest section shaping (ROK-1435 slice L2).
 * Pins the playing/recap shaping and the viewer-free LFG projection
 * (AC5/AC10). Source wiring and the v2 assembly are pinned in
 * `weekly-digest-assembly.helpers.spec.ts`.
 */
import type { GameDetailDto, GameDiscoverRowDto } from '@raid-ledger/contract';
import type { LfgGroupAggregate } from '../lfg/lfg-query.helpers';
import {
  DIGEST_PLAYING_LIMIT,
  shapeLfg,
  shapePlaying,
  shapeRecap,
} from './weekly-digest-data.helpers';
import { nonEmpty } from '../common/testing/narrow';

function game(id: number, extra: Partial<GameDetailDto> = {}): GameDetailDto {
  return {
    id,
    name: `Game ${id}`,
    slug: `game-${id}`,
    ...extra,
  } as GameDetailDto;
}

function row(
  games: GameDetailDto[],
  metadata?: GameDiscoverRowDto['metadata'],
): GameDiscoverRowDto {
  return { category: 'c', slug: 's', games, metadata };
}

function group(overrides: Partial<LfgGroupAggregate> = {}): LfgGroupAggregate {
  return {
    gameId: 7,
    gameName: 'Valheim',
    gameSlug: 'valheim',
    gameCoverUrl: null,
    viabilityThreshold: 4,
    activeCount: 2,
    soonestExpiresAt: new Date('2026-09-23T00:00:00Z'),
    hasOwnIntent: true,
    nowCount: 1,
    soonestNowExpiresAt: null,
    ...overrides,
  };
}

const RECAP = { eventsRun: 3, playersAttended: 5, attendances: 9 };
const EMPTY_RECAP = { eventsRun: 0, playersAttended: 0, attendances: 0 };

describe('shapePlaying', () => {
  it('keeps rank order, caps at the top 5, and reports the full total', () => {
    const games = [1, 2, 3, 4, 5, 6, 7].map((id) => game(id));
    const metadata = Object.fromEntries(
      games.map((g) => [
        String(g.id),
        { playerCount: 10 - g.id, totalSeconds: 60 },
      ]),
    );
    const section = shapePlaying(row(games, metadata));
    expect(DIGEST_PLAYING_LIMIT).toBe(5);
    expect(section.items.map((l) => l.gameId)).toEqual([1, 2, 3, 4, 5]);
    expect(section.items[0]).toEqual({
      gameId: 1,
      name: 'Game 1',
      slug: 'game-1',
      playerCount: 9,
    });
    expect(section.total).toBe(7);
  });

  it('drops games with no player metadata', () => {
    const section = shapePlaying(
      row([game(1), game(2)], { '2': { playerCount: 3, totalSeconds: 1 } }),
    );
    expect(section.items.map((l) => l.gameId)).toEqual([2]);
    expect(section.total).toBe(1);
  });

  it('is empty for an empty row with no metadata', () => {
    expect(shapePlaying(row([]))).toEqual({ items: [], total: 0 });
  });
});

describe('shapeLfg', () => {
  it('projects viewer-independent fields only — never hasOwnIntent', () => {
    const [line] = nonEmpty(
      shapeLfg([group({ hasOwnIntent: true })]).items,
      'line',
    );
    expect(Object.keys(line).sort()).toEqual([
      'activeCount',
      'gameName',
      'gameSlug',
      'isViable',
      'nowCount',
      'playersNeeded',
    ]);
  });

  it('derives viability and players still needed from the threshold', () => {
    const { items } = shapeLfg([
      group({ gameSlug: 'short', activeCount: 2, viabilityThreshold: 4 }),
      group({ gameSlug: 'ready', activeCount: 4, viabilityThreshold: 4 }),
    ]);
    expect(items[0]).toMatchObject({
      gameSlug: 'short',
      isViable: false,
      playersNeeded: 2,
    });
    expect(items[1]).toMatchObject({ gameSlug: 'ready', isViable: true });
  });

  it('is empty when no group is live (AC5: L3 omits the field)', () => {
    expect(shapeLfg([])).toEqual({ items: [], total: 0 });
    expect(shapeLfg([group({ activeCount: 0 })]).items).toEqual([]);
  });
});

describe('shapeRecap', () => {
  it('is null when nothing ran, and the recap otherwise', () => {
    expect(shapeRecap(EMPTY_RECAP)).toBeNull();
    expect(shapeRecap(RECAP)).toEqual(RECAP);
  });
});
