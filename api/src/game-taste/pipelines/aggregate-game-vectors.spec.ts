/**
 * Unit tests for the ROK-1102 #2 TTL batch cache on the game-taste
 * aggregate pipeline.
 *
 * `recomputeGameVector` used to reload the whole corpus (metadata +
 * signals + existing hashes + corpus stats + axis IDF) on EVERY BullMQ
 * job — ~920ms of a 931ms pipeline. These tests pin the 60s TTL cache,
 * the single-flight behaviour on a cold cache, and the cron's
 * always-fresh guarantee.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { GameMetadata, GameSignals } from '../game-vector.helpers';

jest.mock('../../taste-profile/pipelines/aggregate-vectors-loaders', () => ({
  loadGameMetadata: jest.fn(),
  loadGameMetadataForIds: jest.fn(),
}));

jest.mock('./aggregate-game-vectors-loaders', () => ({
  loadGameSignals: jest.fn(),
  loadGameSignalsForIds: jest.fn(),
  loadExistingVectorHashes: jest.fn(),
  computeCorpusStats: jest.fn(() => ({
    maxPlaytimeSeconds: 1000,
    maxInterestCount: 10,
  })),
  hashMetadataArrays: jest.fn((m: { tags: string[] }) => ({
    tagsHash: m.tags.join(','),
    genresHash: 'genres',
    modesHash: 'modes',
    themesHash: 'themes',
  })),
}));

import {
  loadGameMetadata,
  loadGameMetadataForIds,
} from '../../taste-profile/pipelines/aggregate-vectors-loaders';
import {
  loadExistingVectorHashes,
  loadGameSignals,
  loadGameSignalsForIds,
} from './aggregate-game-vectors-loaders';
import {
  __resetBatchCacheForTests,
  recomputeGameVector,
  runAggregateGameVectors,
} from './aggregate-game-vectors';

type Db = PostgresJsDatabase<typeof schema>;

const mockLoadGameMetadata = loadGameMetadata as jest.MockedFunction<
  typeof loadGameMetadata
>;
const mockLoadGameSignals = loadGameSignals as jest.MockedFunction<
  typeof loadGameSignals
>;
const mockLoadExistingHashes = loadExistingVectorHashes as jest.MockedFunction<
  typeof loadExistingVectorHashes
>;
const mockMetadataForIds = loadGameMetadataForIds as jest.MockedFunction<
  typeof loadGameMetadataForIds
>;
const mockSignalsForIds = loadGameSignalsForIds as jest.MockedFunction<
  typeof loadGameSignalsForIds
>;

function metadata(gameId: number): GameMetadata {
  return {
    gameId,
    genres: [4],
    gameModes: [3],
    themes: [1],
    tags: ['survival'],
  };
}

function signals(gameId: number): GameSignals {
  return {
    gameId,
    playtimeSeconds: 500,
    interestCount: 4,
    lastPeriodStart: null,
  };
}

/** Minimal drizzle stand-in: `select` for the cron, `insert` for upserts. */
type UpsertRow = { gameId: number; signalHash: string };

function makeDb(): { db: Db; upserts: UpsertRow[] } {
  const upserts: UpsertRow[] = [];
  const db = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve([{ id: 1 }]) }),
    }),
    insert: () => ({
      values: (row: UpsertRow) => {
        upserts.push({ gameId: row.gameId, signalHash: row.signalHash });
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
  } as unknown as Db;
  return { db, upserts };
}

let now = 1_000_000;

beforeEach(() => {
  __resetBatchCacheForTests();
  jest.clearAllMocks();
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockLoadGameMetadata.mockImplementation(() =>
    Promise.resolve(new Map([[1, metadata(1)]])),
  );
  mockLoadGameSignals.mockImplementation(() =>
    Promise.resolve(new Map([[1, signals(1)]])),
  );
  mockLoadExistingHashes.mockImplementation(() =>
    Promise.resolve(new Map<number, string>()),
  );
  mockMetadataForIds.mockImplementation(() =>
    Promise.resolve(new Map([[1, metadata(1)]])),
  );
  mockSignalsForIds.mockImplementation(() =>
    Promise.resolve(new Map([[1, signals(1)]])),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('recomputeGameVector batch cache (ROK-1102 #2)', () => {
  it('reuses the cached batch for a second job inside the TTL', async () => {
    const { db } = makeDb();
    await recomputeGameVector(db, 1);
    now += 5_000;
    await recomputeGameVector(db, 1);

    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(1);
    expect(mockLoadGameSignals).toHaveBeenCalledTimes(1);
    expect(mockLoadExistingHashes).toHaveBeenCalledTimes(1);
  });

  it('reloads the batch once the 60s TTL has elapsed', async () => {
    const { db } = makeDb();
    await recomputeGameVector(db, 1);
    now += 60_001;
    await recomputeGameVector(db, 1);

    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight load across a burst of concurrent jobs', async () => {
    const { db } = makeDb();
    // Collect EVERY resolver (not just the last) so an uncached
    // implementation fails on the call-count assertion rather than
    // deadlocking into a jest timeout.
    const pending: Array<(value: Map<number, GameMetadata>) => void> = [];
    mockLoadGameMetadata.mockImplementation(
      () =>
        new Promise<Map<number, GameMetadata>>((resolve) => {
          pending.push(resolve);
        }),
    );

    const jobs = Promise.all(
      [1, 1, 1, 1, 1].map((id) => recomputeGameVector(db, id)),
    );
    for (const resolve of pending) resolve(new Map([[1, metadata(1)]]));
    await jobs;

    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(1);
    expect(mockLoadGameSignals).toHaveBeenCalledTimes(1);
  });

  it('skips the repeat upsert for a game already written inside the TTL', async () => {
    const { db, upserts } = makeDb();
    await recomputeGameVector(db, 1);
    await recomputeGameVector(db, 1);

    expect(upserts.map((u) => u.gameId)).toEqual([1]);
  });
});

describe('recomputeGameVector target-game freshness (ROK-1102 #2)', () => {
  it('upserts again when the target game changed inside the TTL', async () => {
    const { db, upserts } = makeDb();
    await recomputeGameVector(db, 1);

    // Game 1 just changed — this is exactly why the job was enqueued.
    mockMetadataForIds.mockImplementation(() =>
      Promise.resolve(new Map([[1, { ...metadata(1), tags: ['roguelike'] }]])),
    );
    mockSignalsForIds.mockImplementation(() =>
      Promise.resolve(
        new Map([[1, { ...signals(1), playtimeSeconds: 9_999 }]]),
      ),
    );
    now += 5_000;
    await recomputeGameVector(db, 1);

    expect(upserts).toHaveLength(2);
    expect(upserts[1].signalHash).not.toEqual(upserts[0].signalHash);
    // ...and the corpus was still only scanned once.
    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(1);
    expect(mockLoadGameSignals).toHaveBeenCalledTimes(1);
  });

  it('re-reads the target game every job while the corpus stays cached', async () => {
    const { db } = makeDb();
    await recomputeGameVector(db, 1);
    now += 5_000;
    await recomputeGameVector(db, 1);
    now += 5_000;
    await recomputeGameVector(db, 1);

    expect(mockMetadataForIds).toHaveBeenCalledTimes(3);
    expect(mockMetadataForIds).toHaveBeenCalledWith(db, [1]);
    expect(mockSignalsForIds).toHaveBeenCalledTimes(3);
    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(1);
    expect(mockLoadGameSignals).toHaveBeenCalledTimes(1);
    expect(mockLoadExistingHashes).toHaveBeenCalledTimes(1);
  });

  it('clears the cache when the load rejects so the next job retries', async () => {
    const { db } = makeDb();
    mockLoadGameMetadata.mockRejectedValueOnce(new Error('db down'));

    await expect(recomputeGameVector(db, 1)).rejects.toThrow('db down');
    await recomputeGameVector(db, 1);

    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(2);
  });
});

describe('runAggregateGameVectors cache interaction (ROK-1102 #2)', () => {
  it('always loads a fresh batch for the cron, even with a warm cache', async () => {
    const { db } = makeDb();
    await recomputeGameVector(db, 1);
    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(1);

    await runAggregateGameVectors(db);

    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(2);
    expect(mockLoadGameSignals).toHaveBeenCalledTimes(2);
  });

  it('primes the cache from the cron so the next job reuses it', async () => {
    const { db } = makeDb();
    await runAggregateGameVectors(db);
    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(1);

    await recomputeGameVector(db, 1);

    expect(mockLoadGameMetadata).toHaveBeenCalledTimes(1);
  });
});
