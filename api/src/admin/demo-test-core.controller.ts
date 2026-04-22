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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { DemoTestService } from './demo-test.service';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { refreshArchetypesFromCurrentMetrics } from './demo-data-install-taste.helpers';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { Inject } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { AuthenticatedRequest } from '../auth/types';
import {
  LinkDiscordSchema,
  EnableNotificationsSchema,
  AwaitProcessingSchema,
} from './demo-test.schemas';
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
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

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
    await this.tasteProfileService.aggregateVectors();
    await this.tasteProfileService.weeklyIntensityRollup();
    const refreshed = await refreshArchetypesFromCurrentMetrics(this.db);
    return { success: true, refreshed };
  }
}
