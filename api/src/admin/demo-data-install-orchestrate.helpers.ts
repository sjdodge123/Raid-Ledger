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

/** Shared deps threaded through the per-entity install steps (ROK-1105). */
interface InstallCtx {
  db: Db;
  batchInsert: BatchInsert;
  allUsers: (typeof schema.users.$inferSelect)[];
  userByName: Map<string, typeof schema.users.$inferSelect>;
  allGames: (typeof schema.games.$inferSelect)[];
  gen: ReturnType<typeof coreH.generateAllData>;
}

interface CoreInstallCtx extends InstallCtx {
  batchInsertReturning: BatchInsertReturning;
}

type EventsResult = Awaited<ReturnType<typeof coreH.installEvents>>;
type CharsResult = Awaited<ReturnType<typeof coreH.installCharacters>>;
type SignupsResult = Awaited<ReturnType<typeof signupsH.installSignups>>;

export async function installCoreEntities(
  db: Db,
  batchInsert: BatchInsert,
  batchInsertReturning: BatchInsertReturning,
  allUsers: (typeof schema.users.$inferSelect)[],
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allGames: (typeof schema.games.$inferSelect)[],
  gen: ReturnType<typeof coreH.generateAllData>,
) {
  const ctx: CoreInstallCtx = {
    db,
    batchInsert,
    batchInsertReturning,
    allUsers,
    userByName,
    allGames,
    gen,
  };
  const { ev, ch } = await installEventsAndCharacters(ctx);
  const su = await installSignupsAndRoster(ctx, ev, ch);
  await installCoreFollowups(ctx, ev, su);
  return {
    events: ev.createdEvents.length,
    characters: ch.createdChars.length,
    signups: su.uniqueSignups.length,
  };
}

/** Events + characters — the rows every later install step keys off. */
async function installEventsAndCharacters(
  ctx: CoreInstallCtx,
): Promise<{ ev: EventsResult; ch: CharsResult }> {
  const gamesBySlug = new Map(ctx.allGames.map((g) => [g.slug, g]));
  const ev = await coreH.installEvents(
    ctx.batchInsertReturning,
    ctx.allUsers[0].id,
    ctx.allGames,
    ctx.gen.events,
  );
  const ch = await coreH.installCharacters(
    ctx.batchInsertReturning,
    ctx.userByName,
    ctx.allGames,
    gamesBySlug,
    ctx.gen.chars,
  );
  return { ev, ch };
}

/** Signups + roster assignments for the created events. */
async function installSignupsAndRoster(
  ctx: CoreInstallCtx,
  ev: EventsResult,
  ch: CharsResult,
): Promise<SignupsResult> {
  const su = await signupsH.installSignups(
    ctx.batchInsertReturning,
    ev.origEvents,
    ev.genEvents,
    ctx.allUsers,
    ctx.userByName,
    ch.charByUserGame,
    ctx.gen.signups,
    ctx.allGames,
  );
  await signupsH.installRosterAssignments(
    ctx.batchInsert,
    su.createdSignups,
    ch.createdChars,
    ev.createdEvents,
    ev.genEvents,
    ctx.gen.events,
    ctx.allGames,
  );
  return su;
}

/** Creator reassignment + activity log, once the core rows exist. */
async function installCoreFollowups(
  ctx: CoreInstallCtx,
  ev: EventsResult,
  su: SignupsResult,
): Promise<void> {
  await secondaryH.reassignEventCreators(
    ctx.db,
    ctx.userByName,
    ctx.allUsers,
    ev.origEvents,
    ev.genEvents,
  );
  await activityH.installActivityLog(
    ctx.db,
    ctx.batchInsert,
    ev.createdEvents,
    su.createdSignups,
  );
}

export async function installSecondaryEntities(
  db: Db,
  batchInsert: BatchInsert,
  allUsers: (typeof schema.users.$inferSelect)[],
  userByName: Map<string, typeof schema.users.$inferSelect>,
  allGames: (typeof schema.games.$inferSelect)[],
  gen: ReturnType<typeof coreH.generateAllData>,
) {
  const ctx: InstallCtx = {
    db,
    batchInsert,
    allUsers,
    userByName,
    allGames,
    gen,
  };
  const igdbIdsByDbId = new Map(allGames.map((g) => [g.igdbId, g.id]));
  const scheduling = await installSchedulingSignals(ctx);
  const notifications = await installEngagementSignals(ctx, igdbIdsByDbId);
  await installTasteSignals(ctx, igdbIdsByDbId);
  return { ...scheduling, notifications };
}

/** Availability + game-time scheduling signals. */
async function installSchedulingSignals(
  ctx: InstallCtx,
): Promise<{ availability: number; gameTimeSlots: number }> {
  const avail = await secondaryH.installAvailability(
    ctx.batchInsert,
    ctx.userByName,
    ctx.gen.avail,
  );
  const gameTime = await secondaryH.installGameTime(
    ctx.batchInsert,
    ctx.userByName,
    ctx.gen.gameTime,
  );
  return { availability: avail.length, gameTimeSlots: gameTime.length };
}

/** The original (non-generated) seed events, looked up by title. */
async function findOriginalEvents(ctx: InstallCtx) {
  const origTitles = getEventsDefinitions(ctx.allGames).map((e) => e.title);
  return ctx.db
    .select()
    .from(schema.events)
    .where(inArray(schema.events.title, origTitles));
}

/** Notifications, notification preferences, and game interests. */
async function installEngagementSignals(
  ctx: InstallCtx,
  igdbIdsByDbId: Map<number | null, number>,
): Promise<number> {
  const origEvents = await findOriginalEvents(ctx);
  const notifs = await secondaryH.installNotifications(
    ctx.batchInsert,
    ctx.db,
    ctx.userByName,
    ctx.allUsers,
    origEvents,
    ctx.gen.notifs,
  );
  await secondaryH.installPreferences(
    ctx.batchInsert,
    ctx.userByName,
    ctx.allUsers,
    ctx.gen.notifPrefs,
  );
  await secondaryH.installGameInterests(
    ctx.batchInsert,
    ctx.userByName,
    igdbIdsByDbId,
    ctx.gen.interests,
  );
  return notifs;
}

/**
 * ROK-1083: seed taste-profile signals so the aggregator derives varied
 * intensity tiers + vector titles. Runs before `runTasteProfileAggregation`,
 * which the caller (demo-data.service.ts) invokes after this install pass.
 */
async function installTasteSignals(
  ctx: InstallCtx,
  igdbIdsByDbId: Map<number | null, number>,
): Promise<void> {
  await tasteH.installGameActivityRollups(
    ctx.batchInsert,
    ctx.userByName,
    igdbIdsByDbId,
    ctx.gen.activityRollups,
  );
  await tasteH.installPlayhistoryInterests(
    ctx.batchInsert,
    ctx.userByName,
    igdbIdsByDbId,
    ctx.gen.playhistoryInterests,
  );
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
