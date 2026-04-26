import { Injectable, Inject, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import type {
  DemoDataStatusDto,
  DemoDataResultDto,
  DemoDataCountsDto,
} from '@raid-ledger/contract';
import { createRng } from './demo-data-generator';
import { getEventsDefinitions } from './demo-data.constants';
import * as coreH from './demo-data-install-core.helpers';
import * as signupsH from './demo-data-install-signups.helpers';
import * as secondaryH from './demo-data-install-secondary.helpers';
import * as activityH from './demo-data-install-activity.helpers';
import * as tasteH from './demo-data-install-taste.helpers';
import * as clearH from './demo-data-clear.helpers';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { CommunityInsightsService } from '../community-insights/community-insights.service';

const BATCH_SIZE = 500;

@Injectable()
export class DemoDataService {
  private readonly logger = new Logger(DemoDataService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly tasteProfileService: TasteProfileService,
    private readonly communityInsightsService: CommunityInsightsService,
  ) {}

  async getStatus(): Promise<DemoDataStatusDto> {
    const demoMode = await this.settingsService.getDemoMode();
    const counts = await clearH.getCounts(this.db);
    return { demoMode, ...counts };
  }

  async installDemoData(): Promise<DemoDataResultDto> {
    const existing = await clearH.getCounts(this.db);
    if (existing.users > 0) {
      return {
        success: false,
        message:
          'Demo data already exists. Delete it first before reinstalling.',
        counts: existing,
      };
    }
    this.logger.log('Installing demo data (~100 users)...');
    try {
      const counts = await this.performInstall();
      this.logger.log('Demo data installed');
      this.logger.debug(`Demo data counts: ${JSON.stringify(counts)}`);
      return this.buildInstallResult(true, counts);
    } catch (error) {
      this.logger.error('Failed to install demo data:', error);
      try {
        await this.clearDemoData();
      } catch {
        /* Best-effort */
      }
      return this.buildInstallResult(false, clearH.emptyCounts(), error);
    }
  }

  async clearDemoData(): Promise<DemoDataResultDto> {
    this.logger.log('Clearing demo data...');
    try {
      const countsBefore = await clearH.getCounts(this.db);
      await clearH.performClear(this.db, this.settingsService);
      this.logger.log('Demo data cleared');
      return {
        success: true,
        message: `Demo data deleted: ${countsBefore.users} users, ${countsBefore.events} events removed`,
        counts: countsBefore,
      };
    } catch (error) {
      this.logger.error('Failed to clear demo data:', error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to clear demo data',
        counts: clearH.emptyCounts(),
      };
    }
  }

  private buildInstallResult(
    success: boolean,
    counts: DemoDataCountsDto,
    error?: unknown,
  ): DemoDataResultDto {
    const message = success
      ? `Demo data installed: ${counts.users} users, ${counts.events} events, ${counts.characters} characters`
      : error instanceof Error
        ? error.message
        : 'Failed to install demo data';
    return { success, message, counts };
  }

  private async performInstall(): Promise<DemoDataCountsDto> {
    const rng = createRng();
    const now = new Date();
    const bir = (
      t: Parameters<typeof this.db.insert>[0],
      r: Record<string, unknown>[],
    ) => this.batchInsertReturning(t, r);
    const { allUsers, userByName } = await coreH.installUsers(bir, this.db);
    const allGames = await this.db.select().from(schema.games);
    const gen = coreH.generateAllData(rng, allGames, now);

    const core = await this.installCoreEntities(
      allUsers,
      userByName,
      allGames,
      gen,
    );
    const secondary = await this.installSecondaryEntities(
      allUsers,
      userByName,
      allGames,
      gen,
    );
    await this.settingsService.setDemoMode(true);
    await this.runTasteProfileAggregation();
    return { users: allUsers.length, ...core, ...secondary };
  }

  private async installCoreEntities(
    allUsers: (typeof schema.users.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allGames: (typeof schema.games.$inferSelect)[],
    gen: ReturnType<typeof coreH.generateAllData>,
  ) {
    const bir = (
      t: Parameters<typeof this.db.insert>[0],
      r: Record<string, unknown>[],
    ) => this.batchInsertReturning(t, r);
    const bi = (
      t: Parameters<typeof this.db.insert>[0],
      r: Record<string, unknown>[],
      o?: 'doNothing',
    ) => this.batchInsert(t, r, o);
    const gamesBySlug = new Map(allGames.map((g) => [g.slug, g]));
    const evResult = await coreH.installEvents(
      bir,
      allUsers[0].id,
      allGames,
      gen.events,
    );
    const chResult = await coreH.installCharacters(
      bir,
      userByName,
      allGames,
      gamesBySlug,
      gen.chars,
    );
    const suResult = await signupsH.installSignups(
      bir,
      evResult.origEvents,
      evResult.genEvents,
      allUsers,
      userByName,
      chResult.charByUserGame,
      gen.signups,
      allGames,
    );
    await signupsH.installRosterAssignments(
      bi,
      suResult.createdSignups,
      chResult.createdChars,
      evResult.createdEvents,
      evResult.genEvents,
      gen.events,
      allGames,
    );
    await secondaryH.reassignEventCreators(
      this.db,
      userByName,
      allUsers,
      evResult.origEvents,
      evResult.genEvents,
    );
    await this.installActivityLog(evResult.createdEvents, suResult.createdSignups);
    return {
      events: evResult.createdEvents.length,
      characters: chResult.createdChars.length,
      signups: suResult.uniqueSignups.length,
    };
  }

  /** Insert activity_log rows for demo events + signups (ROK-1116). */
  private async installActivityLog(
    createdEvents: (typeof schema.events.$inferSelect)[],
    createdSignups: (typeof schema.eventSignups.$inferSelect)[],
  ): Promise<void> {
    if (createdEvents.length === 0) return;
    const eventIds = createdEvents.map((e) => e.id);
    const finalEvents = await this.db
      .select({
        id: schema.events.id,
        creatorId: schema.events.creatorId,
        title: schema.events.title,
      })
      .from(schema.events)
      .where(inArray(schema.events.id, eventIds));
    const rows = [
      ...activityH.buildEventCreatedActivityRows(finalEvents),
      ...activityH.buildSignupAddedActivityRows(createdSignups),
    ];
    if (rows.length > 0) await this.batchInsert(schema.activityLog, rows);
  }

  private async installSecondaryEntities(
    allUsers: (typeof schema.users.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allGames: (typeof schema.games.$inferSelect)[],
    gen: ReturnType<typeof coreH.generateAllData>,
  ) {
    const bi = (
      t: Parameters<typeof this.db.insert>[0],
      r: Record<string, unknown>[],
      o?: 'doNothing',
    ) => this.batchInsert(t, r, o);
    const igdbIdsByDbId = new Map(allGames.map((g) => [g.igdbId, g.id]));
    const origTitles = getEventsDefinitions(allGames).map((e) => e.title);
    const origEvents = await this.db
      .select()
      .from(schema.events)
      .where(inArray(schema.events.title, origTitles));
    const avail = await secondaryH.installAvailability(
      bi,
      userByName,
      gen.avail,
    );
    const gameTime = await secondaryH.installGameTime(
      bi,
      userByName,
      gen.gameTime,
    );
    const notifs = await secondaryH.installNotifications(
      bi,
      this.db,
      userByName,
      allUsers,
      origEvents,
      gen.notifs,
    );
    await secondaryH.installPreferences(
      bi,
      userByName,
      allUsers,
      gen.notifPrefs,
    );
    await secondaryH.installGameInterests(
      bi,
      userByName,
      igdbIdsByDbId,
      gen.interests,
    );
    // ROK-1083: seed taste-profile signals so the aggregator derives varied
    // intensity tiers + vector titles. Runs before the aggregator pass below.
    await tasteH.installGameActivityRollups(
      bi,
      userByName,
      igdbIdsByDbId,
      gen.activityRollups,
    );
    await tasteH.installPlayhistoryInterests(
      bi,
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
  private async runTasteProfileAggregation(): Promise<void> {
    try {
      await this.tasteProfileService.aggregateVectors();
      await this.tasteProfileService.weeklyIntensityRollup();
      await tasteH.refreshArchetypesFromCurrentMetrics(this.db);
      // ROK-1099: Path A — run the real community-insights orchestrator
      // against the freshly-seeded taste data so the dashboard snapshot exists.
      await this.communityInsightsService.refreshSnapshot();
    } catch (err) {
      this.logger.warn(
        `Taste-profile aggregation after demo install failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async batchInsert(
    table: Parameters<PostgresJsDatabase<typeof schema>['insert']>[0],
    rows: Record<string, unknown>[],
    onConflict?: 'doNothing',
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const q = this.db.insert(table).values(batch as never);
      if (onConflict === 'doNothing') {
        await q.onConflictDoNothing();
      } else {
        await q;
      }
    }
  }

  private async batchInsertReturning(
    table: Parameters<PostgresJsDatabase<typeof schema>['insert']>[0],
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const inserted = await this.db
        .insert(table)
        .values(batch as never)
        .returning();
      results.push(...inserted);
    }
    return results;
  }
}
