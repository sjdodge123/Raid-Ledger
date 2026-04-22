import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { DEMO_USERNAMES } from './demo-data.constants';
import {
  createRng,
  generateSignalProfiles,
  generateGameActivityRollups,
  generatePlayhistoryInterests,
} from './demo-data-generator';
import {
  installGameActivityRollups,
  installPlayhistoryInterests,
  refreshArchetypesFromCurrentMetrics,
} from './demo-data-install-taste.helpers';
import {
  LinkDiscordSchema,
  EnableNotificationsSchema,
  AwaitProcessingSchema,
} from './demo-test.schemas';
import { DemoTestService } from './demo-test.service';
import { parseDemoBody } from './demo-test.utils';

/**
 * Core/utility test endpoints — DEMO_MODE only (smoke tests).
 * Covers Discord account linking, notification utilities, and queue draining.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestCoreController {
  constructor(
    private readonly demoTestService: DemoTestService,
    private readonly tasteProfileService: TasteProfileService,
    private readonly settingsService: SettingsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Gate — throws if DEMO_MODE is off. Mirrors DemoTestService.assertDemoMode
   * but the check lives here because the rebuild/reseed endpoints live on
   * this controller and the guard must fire BEFORE pipeline calls run.
   */
  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    const demoMode = await this.settingsService.getDemoMode();
    if (!demoMode) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Link a Discord ID to a user -- DEMO_MODE only (smoke tests). */
  @Post('link-discord')
  @HttpCode(HttpStatus.OK)
  async linkDiscordForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean; user: unknown }> {
    const parsed = parseDemoBody(LinkDiscordSchema, body);
    const user = await this.demoTestService.linkDiscordForTest(
      parsed.userId,
      parsed.discordId,
      parsed.username,
    );
    return { success: true, user };
  }

  /** Enable Discord DM notifications for a user -- DEMO_MODE only. */
  @Post('enable-discord-notifications')
  @HttpCode(HttpStatus.OK)
  async enableDiscordNotificationsForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(EnableNotificationsSchema, body);
    await this.demoTestService.enableDiscordNotificationsForTest(parsed.userId);
    return { success: true };
  }

  /** Query a user's notifications — DEMO_MODE only (smoke tests). */
  @Get('notifications')
  async getNotificationsForTest(
    @Query('userId') userId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ): Promise<unknown[]> {
    const uid = parseInt(userId, 10);
    if (!uid || uid <= 0) throw new BadRequestException('userId required');
    return this.demoTestService.getNotificationsForTest(
      uid,
      type,
      parseInt(limit ?? '20', 10),
    );
  }

  /** Flush the roster notification buffer immediately — DEMO_MODE only. */
  @Post('flush-notification-buffer')
  @HttpCode(HttpStatus.OK)
  async flushNotificationBufferForTest(): Promise<{
    success: boolean;
    flushed: number;
  }> {
    const flushed = await this.demoTestService.flushNotificationBufferForTest();
    return { success: true, flushed };
  }

  /** Drain the embed sync BullMQ queue — DEMO_MODE only. */
  @Post('flush-embed-queue')
  @HttpCode(HttpStatus.OK)
  async flushEmbedQueueForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.flushEmbedQueueForTest();
  }

  /** Wait for all BullMQ queues to drain — DEMO_MODE only. */
  @Post('await-processing')
  @HttpCode(HttpStatus.OK)
  async awaitProcessingForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(AwaitProcessingSchema, body ?? {});
    await this.demoTestService.awaitProcessingForTest(
      parsed.timeoutMs ?? 30_000,
    );
    return { success: true };
  }

  /** Clear game_time_confirmed_at for the authenticated user -- DEMO_MODE only (ROK-999). */
  @Post('clear-game-time-confirmation')
  @HttpCode(HttpStatus.OK)
  async clearGameTimeConfirmationForTest(
    @Request() req: AuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    await this.demoTestService.clearGameTimeConfirmationForTest(req.user.id);
    return { success: true };
  }

  /**
   * Rebuild taste-profile vectors + intensity + archetypes for every user
   * (ROK-1083). Runs aggregate-vectors → weekly-intensity → archetype
   * refresh in the same order the demo installer uses, so existing
   * DB state reflects the latest archetype composition without a full
   * re-install.
   */
  @Post('rebuild-taste-profiles')
  @HttpCode(HttpStatus.OK)
  async rebuildTasteProfilesForTest(): Promise<{
    success: boolean;
    refreshed: number;
  }> {
    await this.assertDemoMode();
    await this.tasteProfileService.aggregateVectors();
    await this.tasteProfileService.weeklyIntensityRollup();
    const refreshed = await refreshArchetypesFromCurrentMetrics(this.db);
    return { success: true, refreshed };
  }

  /**
   * Seed taste-profile signal data (game_activity_rollups +
   * game_interests with playtime) against ALL current users who lack it,
   * then rebuild taste profiles (ROK-1083). Additive — no deletes — so
   * existing real signal data is preserved. Intended for demo
   * environments that predate the ROK-1083 seed code.
   */
  @Post('reseed-taste-profiles')
  @HttpCode(HttpStatus.OK)
  async reseedTasteProfilesForTest(): Promise<{
    success: boolean;
    seededUsers: number;
    refreshed: number;
  }> {
    await this.assertDemoMode();
    const { userByName, igdbIdsByDbId } = await loadDemoMaps(this.db);
    const profiles = await seedDemoSignals(this.db, userByName, igdbIdsByDbId);
    await this.tasteProfileService.aggregateVectors();
    await this.tasteProfileService.weeklyIntensityRollup();
    const refreshed = await refreshArchetypesFromCurrentMetrics(this.db);
    return { success: true, seededUsers: profiles.length, refreshed };
  }
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Scoped to DEMO_USERNAMES — real operator accounts (e.g. roknua) are
 * never included in the returned maps, which is the structural guarantee
 * the reseed flow leans on.
 */
async function loadDemoMaps(db: Db): Promise<{
  userByName: Map<string, { id: number }>;
  igdbIdsByDbId: Map<number | null, number>;
}> {
  const users = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users);
  const games = await db
    .select({ id: schema.games.id, igdbId: schema.games.igdbId })
    .from(schema.games);
  const demoSet = new Set<string>(DEMO_USERNAMES as readonly string[]);
  const demoUsers = users.filter((u) => demoSet.has(u.username));
  return {
    userByName: new Map(demoUsers.map((u) => [u.username, { id: u.id }])),
    igdbIdsByDbId: new Map(games.map((g) => [g.igdbId, g.id])),
  };
}

/** Build inline batch-insert (mirrors `demo-data.service.batchInsert`). */
function makeBatchInsert(db: Db) {
  return async (
    table: Parameters<Db['insert']>[0],
    rows: Record<string, unknown>[],
    onConflict?: 'doNothing',
  ) => {
    if (rows.length === 0) return;
    const q = db.insert(table).values(rows as never);
    await (onConflict === 'doNothing' ? q.onConflictDoNothing() : q);
  };
}

/** Generate + persist signal data for the scoped demo users; returns the
 *  raw profiles so the caller can report `seededUsers`. */
async function seedDemoSignals(
  db: Db,
  userByName: Map<string, { id: number }>,
  igdbIdsByDbId: Map<number | null, number>,
): Promise<ReturnType<typeof generateSignalProfiles>> {
  const rng = createRng();
  const usernames = [...userByName.keys()];
  const profiles = generateSignalProfiles(rng, usernames);
  const activityRollups = generateGameActivityRollups(profiles, new Date());
  const playhistoryInterests = generatePlayhistoryInterests(rng, profiles);
  const batchInsert = makeBatchInsert(db);
  await installGameActivityRollups(
    batchInsert,
    userByName,
    igdbIdsByDbId,
    activityRollups,
  );
  await installPlayhistoryInterests(
    batchInsert,
    userByName,
    igdbIdsByDbId,
    playhistoryInterests,
  );
  return profiles;
}
