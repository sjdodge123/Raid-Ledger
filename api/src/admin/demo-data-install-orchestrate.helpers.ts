// ROK-1142: extracted from demo-data.service.ts
import { Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { getEventsDefinitions } from './demo-data.constants';
import * as coreH from './demo-data-install-core.helpers';
import * as signupsH from './demo-data-install-signups.helpers';
import * as secondaryH from './demo-data-install-secondary.helpers';
import * as activityH from './demo-data-install-activity.helpers';
import * as tasteH from './demo-data-install-taste.helpers';
import type { TasteProfileService } from '../taste-profile/taste-profile.service';
import type { CommunityInsightsService } from '../community-insights/community-insights.service';

type Db = PostgresJsDatabase<typeof schema>;
type BatchInsert = (
  table: Parameters<Db['insert']>[0],
  rows: Record<string, unknown>[],
  onConflict?: 'doNothing',
) => Promise<void>;
type BatchInsertReturning = (
  table: Parameters<Db['insert']>[0],
  rows: Record<string, unknown>[],
) => Promise<Record<string, unknown>[]>;

export async function installCoreEntities(
  db: Db,
  batchInsert: BatchInsert,
  batchInsertReturning: BatchInsertReturning,
  allUsers: (typeof schema.users.$inferSelect)[],
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allGames: (typeof schema.games.$inferSelect)[],
  gen: ReturnType<typeof coreH.generateAllData>,
) {
  const gamesBySlug = new Map(allGames.map((g) => [g.slug, g]));
  const evResult = await coreH.installEvents(
    batchInsertReturning,
    allUsers[0].id,
    allGames,
    gen.events,
  );
  const chResult = await coreH.installCharacters(
    batchInsertReturning,
    userByName,
    allGames,
    gamesBySlug,
    gen.chars,
  );
  const suResult = await signupsH.installSignups(
    batchInsertReturning,
    evResult.origEvents,
    evResult.genEvents,
    allUsers,
    userByName,
    chResult.charByUserGame,
    gen.signups,
    allGames,
  );
  await signupsH.installRosterAssignments(
    batchInsert,
    suResult.createdSignups,
    chResult.createdChars,
    evResult.createdEvents,
    evResult.genEvents,
    gen.events,
    allGames,
  );
  await secondaryH.reassignEventCreators(
    db,
    userByName,
    allUsers,
    evResult.origEvents,
    evResult.genEvents,
  );
  await activityH.installActivityLog(
    db,
    batchInsert,
    evResult.createdEvents,
    suResult.createdSignups,
  );
  return {
    events: evResult.createdEvents.length,
    characters: chResult.createdChars.length,
    signups: suResult.uniqueSignups.length,
  };
}

export async function installSecondaryEntities(
  db: Db,
  batchInsert: BatchInsert,
  allUsers: (typeof schema.users.$inferSelect)[],
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allGames: (typeof schema.games.$inferSelect)[],
  gen: ReturnType<typeof coreH.generateAllData>,
) {
  const igdbIdsByDbId = new Map(allGames.map((g) => [g.igdbId, g.id]));
  const origTitles = getEventsDefinitions(allGames).map((e) => e.title);
  const origEvents = await db
    .select()
    .from(schema.events)
    .where(inArray(schema.events.title, origTitles));
  const avail = await secondaryH.installAvailability(
    batchInsert,
    userByName,
    gen.avail,
  );
  const gameTime = await secondaryH.installGameTime(
    batchInsert,
    userByName,
    gen.gameTime,
  );
  const notifs = await secondaryH.installNotifications(
    batchInsert,
    db,
    userByName,
    allUsers,
    origEvents,
    gen.notifs,
  );
  await secondaryH.installPreferences(
    batchInsert,
    userByName,
    allUsers,
    gen.notifPrefs,
  );
  await secondaryH.installGameInterests(
    batchInsert,
    userByName,
    igdbIdsByDbId,
    gen.interests,
  );
  // ROK-1083: seed taste-profile signals so the aggregator derives varied
  // intensity tiers + vector titles. Runs before the aggregator pass below.
  await tasteH.installGameActivityRollups(
    batchInsert,
    userByName,
    igdbIdsByDbId,
    gen.activityRollups,
  );
  await tasteH.installPlayhistoryInterests(
    batchInsert,
    userByName,
    igdbIdsByDbId,
    gen.playhistoryInterests,
  );
  return {
    availability: avail.length,
    gameTimeSlots: gameTime.length,
    notifications: notifs,
  };
}

/**
 * Run the taste-profile pipelines synchronously after install so the
 * profile pages render composed archetypes immediately.
 *
 * Order matters:
 * 1. `aggregateVectors` creates `player_taste_vectors` rows (archetype
 *    here is stale — intensity_metrics still zero).
 * 2. `weeklyIntensityRollup` reads `game_activity_rollups` and updates
 *    `intensity_metrics` on those rows.
 * 3. `refreshArchetypesFromCurrentMetrics` re-derives archetypes using
 *    the now-correct intensity metrics. The production aggregator's
 *    signalHash guard otherwise skips this recompute.
 *
 * Failures are logged and swallowed — install is still considered
 * successful even if aggregation trips up.
 */
export async function runTasteProfileAggregation(
  db: Db,
  tasteProfileService: TasteProfileService,
  communityInsightsService: CommunityInsightsService,
  logger: Logger,
): Promise<void> {
  try {
    await tasteProfileService.aggregateVectors();
    await tasteProfileService.weeklyIntensityRollup();
    await tasteH.refreshArchetypesFromCurrentMetrics(db);
    // ROK-1099: Path A — run the real community-insights orchestrator
    // against the freshly-seeded taste data so the dashboard snapshot exists.
    await communityInsightsService.refreshSnapshot();
  } catch (err) {
    logger.warn(
      `Taste-profile aggregation after demo install failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
