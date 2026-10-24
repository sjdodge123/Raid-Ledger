/**
 * Archetype re-titling integration tests (ROK-1935).
 *
 * - The weekly intensity job re-derives the archetype in the same write as
 *   the metrics, so no stored title disagrees with its stored intensity.
 * - A player with no presence data (no `game_activity_rollups` row with
 *   seconds > 0) is titled `Newcomer`, not `Casual`.
 */
import { eq } from 'drizzle-orm';
import {
  TASTE_PROFILE_AXIS_POOL,
  type ArchetypeDto,
  type TasteProfileDimensionsDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { deriveTier } from './archetype.helpers';
import { TIER_DESCRIPTIONS } from './archetype-copy';
import { currentWeekStart } from './pipelines/weekly-intensity';
import { TasteProfileService } from './taste-profile.service';
import { nonEmpty } from '../common/testing/narrow';

const STALE_CASUAL: ArchetypeDto = {
  intensityTier: 'Casual',
  vectorTitles: [],
  descriptions: { tier: TIER_DESCRIPTIONS.Casual, titles: [] },
};

function zeroDimensions(): TasteProfileDimensionsDto {
  const dims: Record<string, number> = {};
  for (const axis of TASTE_PROFILE_AXIS_POOL) dims[axis] = 0;
  return dims as TasteProfileDimensionsDto;
}

describe('Archetype re-titling (ROK-1935)', () => {
  let testApp: TestApp;
  let service: TasteProfileService;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(TasteProfileService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedUser(tag: string): Promise<number> {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({ discordId: `d:${tag}`, username: tag, role: 'member' })
        .returning(),
      `user ${tag}`,
    );
    return u.id;
  }

  async function seedGame(name: string): Promise<number> {
    const [g] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name, slug: name.toLowerCase().replace(/\s+/g, '-') })
        .returning(),
      `game ${name}`,
    );
    return g.id;
  }

  /** A taste-vector row pinned to zero intensity and a stale Casual title. */
  async function seedStaleVector(userId: number): Promise<void> {
    await testApp.db.insert(schema.playerTasteVectors).values({
      userId,
      vector: [0, 0, 0, 0, 0, 0, 0],
      dimensions: zeroDimensions(),
      intensityMetrics: { intensity: 0, focus: 0, breadth: 0, consistency: 0 },
      archetype: STALE_CASUAL,
      signalHash: `stale-${userId}`,
    });
  }

  /** This week's rollup + a same-day rollup (feeds the 4w/all-time tiers). */
  async function seedPresence(
    userId: number,
    gameId: number,
    hours: number,
  ): Promise<void> {
    const totalSeconds = hours * 3600;
    await testApp.db.insert(schema.gameActivityRollups).values([
      {
        userId,
        gameId,
        period: 'week',
        periodStart: currentWeekStart().toISOString().slice(0, 10),
        totalSeconds,
      },
      {
        userId,
        gameId,
        period: 'day',
        periodStart: new Date().toISOString().slice(0, 10),
        totalSeconds,
      },
    ]);
  }

  async function loadVector(userId: number) {
    const [row] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.playerTasteVectors)
        .where(eq(schema.playerTasteVectors.userId, userId)),
      `vector ${userId}`,
    );
    return row;
  }

  it('the weekly job re-titles a stale profile to match its new intensity', async () => {
    const game = await seedGame('Retitle Game');
    const heavy = await seedUser('heavy');
    const lightA = await seedUser('light-a');
    const lightB = await seedUser('light-b');
    for (const id of [heavy, lightA, lightB]) await seedStaleVector(id);
    await seedPresence(heavy, game, 50);
    await seedPresence(lightA, game, 1);
    await seedPresence(lightB, game, 1);

    await service.weeklyIntensityRollup();

    // 2.5 of 3 at-or-below in all three windows → intensity ≈ 83 → Dedicated.
    const row = await loadVector(heavy);
    expect(row.intensityMetrics.intensity).toBeGreaterThanOrEqual(60);
    expect(row.archetype?.intensityTier).toBe('Dedicated');
    expect(row.archetype?.descriptions.tier).toBe(TIER_DESCRIPTIONS.Dedicated);
  });

  it('after a weekly run no profile title disagrees with its stored intensity', async () => {
    const game = await seedGame('Agree Game');
    const busy = await seedUser('a1');
    const idle = await seedUser('a2');
    const absent = await seedUser('a3');
    for (const id of [busy, idle, absent]) await seedStaleVector(id);
    await seedPresence(busy, game, 40);
    await seedPresence(idle, game, 5);
    // `absent` has no presence data at all.

    await service.weeklyIntensityRollup();

    const rows = await testApp.db.select().from(schema.playerTasteVectors);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const hasPresence = row.userId !== absent;
      expect({
        userId: row.userId,
        tier: row.archetype?.intensityTier,
      }).toEqual({
        userId: row.userId,
        tier: deriveTier(row.intensityMetrics.intensity, hasPresence),
      });
    }
  });

  it('the weekly job titles a profile with no presence data Newcomer, not Casual', async () => {
    const userId = await seedUser('no-presence');
    await seedStaleVector(userId);

    await service.weeklyIntensityRollup();

    const row = await loadVector(userId);
    expect(row.archetype?.intensityTier).toBe('Newcomer');
    expect(row.archetype?.descriptions.tier).toBe(TIER_DESCRIPTIONS.Newcomer);
  });

  it('the daily aggregate titles a new no-presence player Newcomer', async () => {
    const userId = await seedUser('steam-only');
    const game = await seedGame('Library Game');
    await testApp.db.insert(schema.gameInterests).values({
      userId,
      gameId: game,
      source: 'steam_library',
      playtimeForever: 600,
    });

    await service.aggregateVectors();

    const row = await loadVector(userId);
    expect(row.archetype?.intensityTier).toBe('Newcomer');
  });
});
