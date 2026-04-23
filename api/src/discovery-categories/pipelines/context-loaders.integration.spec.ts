/**
 * Integration tests for the dynamic-discovery-category context loaders
 * (ROK-567). Exercises the four loaders against a real Postgres instance
 * through the shared Testcontainers test app.
 */
import { TASTE_PROFILE_AXIS_POOL } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import {
  loadCommunityCentroid,
  loadExistingApprovedCategories,
  loadTopPlayedLastMonth,
  loadTrending,
} from './context-loaders';

const ZERO_DIMENSIONS = Object.fromEntries(
  TASTE_PROFILE_AXIS_POOL.map((a) => [a, 0]),
) as Record<(typeof TASTE_PROFILE_AXIS_POOL)[number], number>;

describe('discovery-categories context loaders (ROK-567)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedPlayerVector(
    discordId: string,
    vector: number[],
    ageDays = 0,
  ): Promise<void> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({ discordId, username: discordId, role: 'member' })
      .returning();
    const computedAt = new Date();
    computedAt.setUTCDate(computedAt.getUTCDate() - ageDays);
    await testApp.db.insert(schema.playerTasteVectors).values({
      userId: user.id,
      vector,
      dimensions: ZERO_DIMENSIONS,
      intensityMetrics: {
        intensity: 0,
        focus: 0,
        breadth: 0,
        consistency: 0,
      },
      archetype: null,
      computedAt,
      signalHash: `hash-${discordId}`,
    });
  }

  describe('loadCommunityCentroid', () => {
    it('returns null when no active player vectors exist', async () => {
      const centroid = await loadCommunityCentroid(testApp.db);
      expect(centroid).toBeNull();
    });

    it('returns element-wise mean of recent vectors', async () => {
      await seedPlayerVector('alice', [1, 0, 0, 0, 0, 0, 0]);
      await seedPlayerVector('bob', [0, 1, 0, 0, 0, 0, 0]);
      const centroid = await loadCommunityCentroid(testApp.db);
      expect(centroid).not.toBeNull();
      expect(centroid![0]).toBeCloseTo(0.5, 6);
      expect(centroid![1]).toBeCloseTo(0.5, 6);
      expect(centroid![2]).toBeCloseTo(0, 6);
    });

    it('ignores vectors older than the activity window', async () => {
      await seedPlayerVector('stale', [1, 1, 1, 1, 1, 1, 1], 90);
      const centroid = await loadCommunityCentroid(testApp.db);
      expect(centroid).toBeNull();
    });
  });

  describe('loadTopPlayedLastMonth', () => {
    it('returns empty when no monthly rollups exist', async () => {
      const rows = await loadTopPlayedLastMonth(testApp.db, 5);
      expect(rows).toEqual([]);
    });

    it('ranks games by total seconds in the most recent month bucket', async () => {
      const [u] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'top-player',
          username: 'top-player',
          role: 'member',
        })
        .returning();
      const [gameA] = await testApp.db
        .insert(schema.games)
        .values({ name: 'Alpha', slug: 'alpha' })
        .returning();
      const [gameB] = await testApp.db
        .insert(schema.games)
        .values({ name: 'Beta', slug: 'beta' })
        .returning();
      const periodStart = '2026-04-01';
      await testApp.db.insert(schema.gameActivityRollups).values([
        {
          userId: u.id,
          gameId: gameA.id,
          period: 'month',
          periodStart,
          totalSeconds: 1000,
        },
        {
          userId: u.id,
          gameId: gameB.id,
          period: 'month',
          periodStart,
          totalSeconds: 4000,
        },
      ]);
      const rows = await loadTopPlayedLastMonth(testApp.db, 5);
      expect(rows.map((r) => r.name)).toEqual(['Beta', 'Alpha']);
      expect(rows[0].totalSeconds).toBe(4000);
    });
  });

  describe('loadTrending', () => {
    it('returns empty when fewer than two weekly buckets exist', async () => {
      const rows = await loadTrending(testApp.db, 5);
      expect(rows).toEqual([]);
    });

    it('computes percentage delta between the two most recent weeks', async () => {
      const [u] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'trend-player',
          username: 'trend-player',
          role: 'member',
        })
        .returning();
      const [game] = await testApp.db
        .insert(schema.games)
        .values({ name: 'Gamma', slug: 'gamma' })
        .returning();
      await testApp.db.insert(schema.gameActivityRollups).values([
        {
          userId: u.id,
          gameId: game.id,
          period: 'week',
          periodStart: '2026-04-08',
          totalSeconds: 100,
        },
        {
          userId: u.id,
          gameId: game.id,
          period: 'week',
          periodStart: '2026-04-15',
          totalSeconds: 200,
        },
      ]);
      const rows = await loadTrending(testApp.db, 5);
      expect(rows).toEqual([{ name: 'Gamma', deltaPct: 100 }]);
    });
  });

  describe('loadExistingApprovedCategories', () => {
    it('returns only approved rows with name + category_type', async () => {
      await testApp.db.insert(schema.discoveryCategorySuggestions).values([
        {
          name: 'Approved Row',
          description: 'a',
          categoryType: 'trend',
          themeVector: [0, 0, 0, 0, 0, 0, 0],
          status: 'approved',
          populationStrategy: 'vector',
        },
        {
          name: 'Pending Row',
          description: 'b',
          categoryType: 'seasonal',
          themeVector: [0, 0, 0, 0, 0, 0, 0],
          status: 'pending',
          populationStrategy: 'vector',
        },
      ]);
      const rows = await loadExistingApprovedCategories(testApp.db);
      expect(rows).toEqual([
        { name: 'Approved Row', categoryType: 'trend' },
      ]);
    });
  });
});
