/**
 * Tests for ranking inside IgdbService.searchLocalGames (ROK-1084).
 *
 * Prod incident: DM "Search by Game" picks the wrong game variant when a
 * search term matches multiple sibling rows. The downstream events tree
 * uses games[0]; if the unsorted DB result does not surface the most
 * relevant row first, the chosen gameId is wrong and events are missed.
 *
 * The fix lives in two layers:
 *   1) Service-level: searchLocalGames must apply sortByRelevance so that
 *      exact-name matches outrank partial matches.
 *   2) Tree-level: searchEventsByGame must merge events from the top 5
 *      ranked games (covered in events.tree.spec.ts).
 *
 * These tests exercise (1). They will FAIL until IgdbService.searchLocalGames
 * pipes its result through sortByRelevance.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { IgdbService } from './igdb.service';
import { IGDB_SYNC_QUEUE } from './igdb-sync.constants';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { ItadService } from '../itad/itad.service';
import { GameTasteService } from '../game-taste/game-taste.service';

interface ThenableQuery {
  then: (
    resolve: (v: unknown[]) => void,
    reject?: (e: unknown) => void,
  ) => Promise<void>;
  limit: jest.Mock;
  orderBy: jest.Mock;
  groupBy: jest.Mock;
  where: jest.Mock;
}

function thenableResult(data: unknown[]): ThenableQuery {
  const obj: ThenableQuery = {
    then: (resolve, reject?) => Promise.resolve(data).then(resolve, reject),
    limit: jest.fn().mockImplementation(() => thenableResult(data)),
    orderBy: jest.fn().mockImplementation(() => thenableResult(data)),
    groupBy: jest.fn().mockImplementation(() => thenableResult(data)),
    where: jest.fn().mockImplementation(() => thenableResult(data)),
  };
  return obj;
}

/**
 * Build a minimal games row. Only the fields searchLocalGames + mapDbRowToDetail
 * touch are meaningful here; the rest exist to satisfy the type.
 */
function gameRow(overrides: { id: number; name: string }) {
  return {
    id: overrides.id,
    igdbId: 1000 + overrides.id,
    name: overrides.name,
    slug: overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
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
    cachedAt: new Date(),
    hidden: false,
    banned: false,
  };
}

describe('IgdbService.searchLocalGames — relevance ranking (ROK-1084)', () => {
  let service: IgdbService;
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
  };
  let selectResults: unknown[];

  beforeEach(async () => {
    /**
     * Three sibling rows. Order returned by the DB is intentionally NOT
     * the desired output order: the partial-match "Wrath of the Lich King"
     * comes first, the exact match "World of Warcraft" comes last. Without
     * sortByRelevance the service would surface the wrong row to the
     * events tree, exactly mirroring the prod BC Classic / Anniversary
     * Edition bug from ROK-1084.
     */
    selectResults = [
      gameRow({ id: 11, name: 'World of Warcraft: Wrath of the Lich King' }),
      gameRow({ id: 12, name: 'World of Warcraft: Burning Crusade Classic' }),
      gameRow({ id: 13, name: 'World of Warcraft' }),
    ];

    mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest
            .fn()
            .mockImplementation(() => thenableResult(selectResults)),
        })),
      })),
      insert: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IgdbService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            setex: jest.fn().mockResolvedValue('OK'),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getIgdbConfig: jest.fn().mockResolvedValue(null),
            isIgdbConfigured: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: getQueueToken(IGDB_SYNC_QUEUE),
          useValue: { add: jest.fn(), name: 'igdb-sync' },
        },
        {
          provide: CronJobService,
          useValue: {
            executeWithTracking: jest.fn(
              (_n: string, fn: () => Promise<void>) => fn(),
            ),
          },
        },
        {
          provide: ItadService,
          useValue: {
            searchGames: jest.fn().mockResolvedValue([]),
            lookupSteamAppIds: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: GameTasteService,
          useValue: { enqueueRecompute: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<IgdbService>(IgdbService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('places the exact-name match first', async () => {
    const result = await service.searchLocalGames('world of warcraft');

    expect(result.games.length).toBe(3);
    // The exact-match row must surface first so downstream callers
    // (events tree, lineup tree) pick the correct gameId. With no
    // sortByRelevance applied, this assertion fails — DB returns
    // "Wrath of the Lich King" at index 0.
    expect(result.games[0].name).toBe('World of Warcraft');
    expect(result.games[0].id).toBe(13);
  });

  it('orders sibling rows by relevance, not insertion order', async () => {
    const result = await service.searchLocalGames('world of warcraft');

    const names = result.games.map((g) => g.name);
    // Relevance scores: exact=4, contains=2, contains=2.
    // Exact match wins; the other two tie at relevance 2 and fall back
    // to alphabetical: Burning Crusade Classic before Wrath of the Lich King.
    expect(names).toEqual([
      'World of Warcraft',
      'World of Warcraft: Burning Crusade Classic',
      'World of Warcraft: Wrath of the Lich King',
    ]);
  });
});
