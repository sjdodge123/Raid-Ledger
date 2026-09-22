/**
 * Unit tests for the weekly-digest data assembly (ROK-1435 slice L2).
 * Pins the section shaping, the viewer-free LFG projection (AC5/AC10), the
 * all-empty check L4 relies on, per-section failure isolation, and that the
 * production wiring calls the existing reads with the ruled privacy setting.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type { GameDetailDto, GameDiscoverRowDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import type { LfgGroupAggregate } from '../lfg/lfg-query.helpers';
import * as lfgQuery from '../lfg/lfg-query.helpers';
import * as communityPlaying from '../igdb/igdb-discover-community-playing.helpers';
import * as deals from '../igdb/igdb-discover-deals.helpers';
import * as recapHelpers from './weekly-digest-recap.helpers';
import {
  DIGEST_DEALS_LIMIT,
  DIGEST_PLAYING_LIMIT,
  assembleDigestSections,
  buildDigestSources,
  isDigestEmpty,
  shapeDeals,
  shapeLfg,
  shapePlaying,
  shapeRecap,
  type DigestSections,
  type DigestSources,
} from './weekly-digest-data.helpers';

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

describe('shapeDeals', () => {
  it('caps at the top 3 and carries cut + price', () => {
    const games = [1, 2, 3, 4].map((id) =>
      game(id, { itadCurrentCut: 50, itadCurrentPrice: 9.99 }),
    );
    const section = shapeDeals(row(games));
    expect(DIGEST_DEALS_LIMIT).toBe(3);
    expect(section.items).toHaveLength(3);
    expect(section.items[0]).toEqual({
      gameId: 1,
      name: 'Game 1',
      slug: 'game-1',
      cutPercent: 50,
      price: 9.99,
    });
    expect(section.total).toBe(4);
  });

  it('drops games without a positive discount and nulls a missing price', () => {
    const section = shapeDeals(
      row([
        game(1, { itadCurrentCut: 0 }),
        game(2, { itadCurrentCut: null }),
        game(3, { itadCurrentCut: 25 }),
      ]),
    );
    expect(section.items).toEqual([
      {
        gameId: 3,
        name: 'Game 3',
        slug: 'game-3',
        cutPercent: 25,
        price: null,
      },
    ]);
  });
});

describe('shapeLfg', () => {
  it('projects viewer-independent fields only — never hasOwnIntent', () => {
    const [line] = shapeLfg([group({ hasOwnIntent: true })]).items;
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

describe('isDigestEmpty', () => {
  const empty: DigestSections = {
    playing: { items: [], total: 0 },
    recap: null,
    deals: { items: [], total: 0 },
    lfg: { items: [], total: 0 },
  };

  it('is true only when every section is empty', () => {
    expect(isDigestEmpty(empty)).toBe(true);
    expect(isDigestEmpty({ ...empty, recap: RECAP })).toBe(false);
    expect(isDigestEmpty({ ...empty, lfg: shapeLfg([group()]) })).toBe(false);
    expect(
      isDigestEmpty({
        ...empty,
        deals: shapeDeals(row([game(1, { itadCurrentCut: 10 })])),
      }),
    ).toBe(false);
    const played = shapePlaying(
      row([game(1)], { '1': { playerCount: 1, totalSeconds: 1 } }),
    );
    expect(isDigestEmpty({ ...empty, playing: played })).toBe(false);
  });
});

function sources(overrides: Partial<DigestSources> = {}): DigestSources {
  return {
    communityPlaying: () =>
      Promise.resolve(
        row([game(1)], { '1': { playerCount: 2, totalSeconds: 1 } }),
      ),
    recap: () => Promise.resolve(RECAP),
    wishlistedOnSale: () =>
      Promise.resolve(row([game(2, { itadCurrentCut: 30 })])),
    lfgGroups: () => Promise.resolve([group()]),
    ...overrides,
  };
}

describe('assembleDigestSections', () => {
  it('assembles all four sections', async () => {
    const sections = await assembleDigestSections(sources());
    expect(sections.playing.items.map((l) => l.gameId)).toEqual([1]);
    expect(sections.recap).toEqual(RECAP);
    expect(sections.deals.items.map((l) => l.gameId)).toEqual([2]);
    expect(sections.lfg.items.map((l) => l.gameSlug)).toEqual(['valheim']);
  });

  it('empties only the failing section and reports it', async () => {
    const onError = jest.fn();
    const boom = new Error('redis down');
    const sections = await assembleDigestSections(
      sources({ wishlistedOnSale: () => Promise.reject(boom) }),
      onError,
    );
    expect(sections.deals).toEqual({ items: [], total: 0 });
    expect(sections.recap).toEqual(RECAP);
    expect(sections.playing.items).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('deals', boom);
  });

  it('a failed recap becomes null, not a throw', async () => {
    const sections = await assembleDigestSections(
      sources({ recap: () => Promise.reject(new Error('db')) }),
    );
    expect(sections.recap).toBeNull();
  });
});

describe('buildDigestSources — production wiring', () => {
  const db = {} as PostgresJsDatabase<typeof schema>;
  const redis = {} as Redis;

  afterEach(() => jest.restoreAllMocks());

  it('reads the recap with the show_activity opt-out honoured (Decision 4a)', async () => {
    const spy = jest
      .spyOn(recapHelpers, 'fetchWeeklyRecap')
      .mockResolvedValue(RECAP);
    await buildDigestSources(db, redis).recap();
    expect(spy).toHaveBeenCalledWith(db, { respectActivityOptOut: true });
  });

  it('reads LFG through the viewer-free list, never the per-viewer one', async () => {
    const channel = jest
      .spyOn(lfgQuery, 'listActiveGroupsForChannel')
      .mockResolvedValue([]);
    const perViewer = jest.spyOn(lfgQuery, 'listActiveGroups');
    await buildDigestSources(db, redis).lfgGroups();
    expect(channel).toHaveBeenCalledWith(db);
    expect(perViewer).not.toHaveBeenCalled();
  });

  it('reuses the discover rows with the discover cache TTL', async () => {
    const playing = jest
      .spyOn(communityPlaying, 'fetchCommunityPlayingRow')
      .mockResolvedValue(row([]));
    const onSale = jest
      .spyOn(deals, 'fetchWishlistedOnSaleRow')
      .mockResolvedValue(row([]));
    const built = buildDigestSources(db, redis);
    await built.communityPlaying();
    await built.wishlistedOnSale();
    expect(playing).toHaveBeenCalledWith(
      db,
      redis,
      expect.objectContaining({ slug: 'community-has-been-playing' }),
      3600,
    );
    expect(onSale).toHaveBeenCalledWith(db, redis, 3600);
  });
});
