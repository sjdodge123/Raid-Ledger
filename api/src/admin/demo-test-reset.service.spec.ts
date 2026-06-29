import { Test } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { DemoTestResetService } from './demo-test-reset.service';
import { DemoDataService } from './demo-data.service';
import { QueueHealthService } from '../queue/queue-health.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Build a mock drizzle db whose `.execute()` returns the given snapshot
 * counts on each successive call. Used to drive the wipe path.
 */
function buildExecMockDb(snapshotCounts: number[]) {
  let snapIdx = 0;
  const calls: string[] = [];
  const execute = jest.fn((q: { sql?: string } | string) => {
    const text = typeof q === 'string' ? q : (q.sql ?? JSON.stringify(q));
    calls.push(text);
    if (text.includes('SELECT COUNT')) {
      const value = snapshotCounts[snapIdx] ?? 0;
      snapIdx += 1;
      return Promise.resolve([{ count: String(value) }]);
    }
    return Promise.resolve([]);
  });
  return { db: { execute } as never, executeMock: execute, calls };
}

function buildMockDemoData(success = true, message = '') {
  return {
    clearDemoData: jest.fn().mockResolvedValue({
      success: true,
      message: 'cleared',
      counts: { users: 0 },
    }),
    installDemoData: jest.fn().mockResolvedValue({
      success,
      message,
      counts: { users: 100, events: 30 },
    }),
  };
}

function buildMockQueue() {
  return {
    drainAll: jest.fn().mockResolvedValue(undefined),
    awaitDrained: jest.fn().mockResolvedValue(undefined),
  };
}

function buildMockSettings() {
  return {
    setDemoMode: jest.fn().mockResolvedValue(undefined),
    getDemoMode: jest.fn().mockResolvedValue(true),
  };
}

function buildMockRedis() {
  return {
    keys: jest.fn((): Promise<string[]> => Promise.resolve([])),
    del: jest.fn(() => Promise.resolve(0)),
  };
}

async function buildService(
  db: unknown,
  demoData: ReturnType<typeof buildMockDemoData>,
  queue: ReturnType<typeof buildMockQueue>,
  settings: ReturnType<typeof buildMockSettings> = buildMockSettings(),
  redis: ReturnType<typeof buildMockRedis> = buildMockRedis(),
): Promise<DemoTestResetService> {
  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === QueueHealthService) return queue;
      throw new Error(`Unexpected ModuleRef.get(${String(token)})`);
    }),
  };
  const module = await Test.createTestingModule({
    providers: [
      DemoTestResetService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: REDIS_CLIENT, useValue: redis },
      { provide: DemoDataService, useValue: demoData },
      { provide: SettingsService, useValue: settings },
      { provide: ModuleRef, useValue: moduleRef },
    ],
  }).compile();
  return module.get(DemoTestResetService);
}

/** 12 snapshot counts — one per table in WipeCounts (matches COUNT_TABLES). */
const POPULATED_SNAPSHOT = [5, 12, 2, 4, 6, 3, 0, 1, 7, 9, 4, 2];
const EMPTY_SNAPSHOT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Redis glob patterns flushed by flushDedupRedisCache. Must stay in lock-step
 * with the `patterns` array in demo-test-reset.service.ts (ROK-1062 + ROK-1202:
 * recruitment-* + game-alert* added so recruitment/game-alert specs that recycle
 * event IDs don't inherit stale dedup keys).
 */
const EXPECTED_DEDUP_PATTERNS = [
  'lineup-*',
  'event-*',
  'tiebreaker-*',
  'scheduling-*',
  'standalone-poll-*',
  'recruitment-*',
  'game-alert*',
];

describe('DemoTestResetService', () => {
  it('returns deleted counts and reseed=ok on a populated DB', async () => {
    const { db } = buildExecMockDb(POPULATED_SNAPSHOT);
    const demoData = buildMockDemoData(true);
    const queue = buildMockQueue();
    const svc = await buildService(db, demoData, queue);

    const result = await svc.resetToSeed();

    expect(result.success).toBe(true);
    expect(result.reseed).toEqual({ ok: true });
    expect(result.deleted).toEqual({
      events: 5,
      signups: 12,
      lineups: 2,
      lineupEntries: 4,
      lineupVotes: 6,
      characters: 3,
      voiceSessions: 0,
      rosterAssignments: 1,
      availability: 7,
      eventPlans: 9,
      lineupAiSuggestions: 4,
      questProgress: 2,
    });
    expect(demoData.installDemoData).toHaveBeenCalledTimes(1);
    expect(queue.awaitDrained).toHaveBeenCalledTimes(1);
  });

  it('calls clearDemoData before installDemoData (deletes demo users so install can run)', async () => {
    const { db } = buildExecMockDb(EMPTY_SNAPSHOT);
    const demoData = buildMockDemoData(true);
    const queue = buildMockQueue();
    const svc = await buildService(db, demoData, queue);
    const order: string[] = [];
    demoData.clearDemoData.mockImplementation(() => {
      order.push('clear');
      return Promise.resolve({ success: true, message: '', counts: {} });
    });
    demoData.installDemoData.mockImplementation(() => {
      order.push('install');
      return Promise.resolve({ success: true, message: '', counts: {} });
    });

    await svc.resetToSeed();

    expect(order).toEqual(['clear', 'install']);
  });

  it('re-asserts demoMode=true between clear and install (prevents 403 flicker)', async () => {
    const { db } = buildExecMockDb(EMPTY_SNAPSHOT);
    const demoData = buildMockDemoData(true);
    const queue = buildMockQueue();
    const settings = buildMockSettings();
    const svc = await buildService(db, demoData, queue, settings);
    const order: string[] = [];
    demoData.clearDemoData.mockImplementation(() => {
      order.push('clear');
      return Promise.resolve({ success: true, message: '', counts: {} });
    });
    settings.setDemoMode.mockImplementation(() => {
      order.push('setDemoMode(true)');
      return Promise.resolve();
    });
    demoData.installDemoData.mockImplementation(() => {
      order.push('install');
      return Promise.resolve({ success: true, message: '', counts: {} });
    });

    await svc.resetToSeed();

    expect(order).toEqual(['clear', 'setDemoMode(true)', 'install']);
    expect(settings.setDemoMode).toHaveBeenCalledWith(true);
  });

  it('returns ok=false when clearDemoData fails', async () => {
    const { db } = buildExecMockDb(EMPTY_SNAPSHOT);
    const demoData = buildMockDemoData(true);
    demoData.clearDemoData.mockResolvedValueOnce({
      success: false,
      message: 'FK violation on demo users',
      counts: {},
    });
    const queue = buildMockQueue();
    const svc = await buildService(db, demoData, queue);

    const result = await svc.resetToSeed();

    expect(result.success).toBe(false);
    expect(result.reseed.ok).toBe(false);
    expect(result.reseed.message).toMatch(/clear failed/i);
    expect(demoData.installDemoData).not.toHaveBeenCalled();
  });

  it('returns ok=false when installer fails', async () => {
    const { db } = buildExecMockDb(EMPTY_SNAPSHOT);
    const demoData = buildMockDemoData(false, 'IGDB unavailable');
    const queue = buildMockQueue();
    const svc = await buildService(db, demoData, queue);

    const result = await svc.resetToSeed();

    expect(result.success).toBe(false);
    expect(result.reseed.ok).toBe(false);
    expect(result.reseed.message).toMatch(/IGDB unavailable/);
  });

  it('skips TRUNCATE when all tables are empty (idempotent fast path)', async () => {
    const { db, calls } = buildExecMockDb(EMPTY_SNAPSHOT);
    const demoData = buildMockDemoData(true);
    const queue = buildMockQueue();
    const svc = await buildService(db, demoData, queue);

    await svc.resetToSeed();

    const truncateCalls = calls.filter((c) => /TRUNCATE/i.test(c));
    expect(truncateCalls).toHaveLength(0);
  });

  it('awaits queue drain AFTER reseeding (so post-install jobs settle)', async () => {
    const { db } = buildExecMockDb([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const demoData = buildMockDemoData(true);
    const queue = buildMockQueue();
    const svc = await buildService(db, demoData, queue);

    const drainOrder: string[] = [];
    demoData.installDemoData.mockImplementation(() => {
      drainOrder.push('install');
      return Promise.resolve({ success: true, message: '', counts: {} });
    });
    queue.awaitDrained.mockImplementation(() => {
      drainOrder.push('awaitDrained');
      return Promise.resolve();
    });

    await svc.resetToSeed();

    expect(drainOrder).toEqual(['install', 'awaitDrained']);
  });

  it('flushes every dedup pattern and deletes the matched keys', async () => {
    const { db } = buildExecMockDb(EMPTY_SNAPSHOT);
    const demoData = buildMockDemoData(true);
    const queue = buildMockQueue();
    const redis = buildMockRedis();
    // First keys() call (pattern 'lineup-*') returns stale dedup keys; rest [].
    redis.keys.mockResolvedValueOnce([
      'lineup-reminder:1:99:24h',
      'lineup-poll-closing:1',
    ]);
    const svc = await buildService(
      db,
      demoData,
      queue,
      buildMockSettings(),
      redis,
    );

    await svc.resetToSeed();

    expect(redis.keys).toHaveBeenCalledTimes(EXPECTED_DEDUP_PATTERNS.length);
    for (const pattern of EXPECTED_DEDUP_PATTERNS) {
      expect(redis.keys).toHaveBeenCalledWith(pattern);
    }
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith(
      'lineup-reminder:1:99:24h',
      'lineup-poll-closing:1',
    );
  });
});
