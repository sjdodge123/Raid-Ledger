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
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DemoTestService } from './demo-test.service';
import { LineupSteamNudgeService } from '../lineups/lineup-steam-nudge.service';
import type { AuthenticatedRequest } from '../auth/types';
import {
  LinkDiscordSchema,
  EnableNotificationsSchema,
  AddGameInterestSchema,
  TriggerDepartureSchema,
  CancelSignupSchema,
  TriggerClassifySchema,
  InjectVoiceSessionSchema,
  AwaitProcessingSchema,
  SetSteamAppIdSchema,
  ClearGameInterestSchema,
  CreateTestSignupSchema,
  SetEventTimesSchema,
} from './demo-test.schemas';

/**
 * Controller for demo/test-only endpoints used by smoke tests.
 * All endpoints require admin auth and DEMO_MODE to be enabled.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestController {
  constructor(
    private readonly demoTestService: DemoTestService,
    private readonly steamNudge: LineupSteamNudgeService,
  ) {}

  /** Link a Discord ID to a user -- DEMO_MODE only (smoke tests). */
  @Post('link-discord')
  @HttpCode(HttpStatus.OK)
  async linkDiscordForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean; user: unknown }> {
    const parsed = this.parseBody(LinkDiscordSchema, body);
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
    const parsed = this.parseBody(EnableNotificationsSchema, body);
    await this.demoTestService.enableDiscordNotificationsForTest(parsed.userId);
    return { success: true };
  }

  /** Create a signup for any user -- DEMO_MODE only (smoke tests). */
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  async createSignupForTest(@Body() body: unknown): Promise<unknown> {
    const parsed = this.parseBody(CreateTestSignupSchema, body);
    return this.demoTestService.createSignupForTest(
      parsed.eventId,
      parsed.userId,
      {
        preferredRoles: parsed.preferredRoles,
        characterId: parsed.characterId,
        status: parsed.status,
      },
    );
  }

  /** Add a game interest for a user -- DEMO_MODE only (smoke tests). */
  @Post('add-game-interest')
  @HttpCode(HttpStatus.OK)
  async addGameInterestForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(AddGameInterestSchema, body);
    await this.demoTestService.addGameInterestForTest(
      parsed.userId,
      parsed.gameId,
    );
    return { success: true };
  }

  /** Enqueue a departure grace job with 0 delay — DEMO_MODE only (smoke tests). */
  @Post('trigger-departure')
  @HttpCode(HttpStatus.OK)
  async triggerDepartureForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(TriggerDepartureSchema, body);
    await this.demoTestService.triggerDepartureForTest(
      parsed.eventId,
      parsed.signupId,
      parsed.discordUserId,
    );
    return { success: true };
  }

  /** Cancel a user's signup (triggers bufferLeave) — DEMO_MODE only. */
  @Post('cancel-signup')
  @HttpCode(HttpStatus.OK)
  async cancelSignupForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(CancelSignupSchema, body);
    await this.demoTestService.cancelSignupForTest(
      parsed.eventId,
      parsed.userId,
    );
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

  /** Flush voice attendance sessions to the DB — DEMO_MODE only. */
  @Post('flush-voice-sessions')
  @HttpCode(HttpStatus.OK)
  async flushVoiceSessionsForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.flushVoiceSessionsForTest();
  }

  /** Drain the embed sync BullMQ queue — DEMO_MODE only. */
  @Post('flush-embed-queue')
  @HttpCode(HttpStatus.OK)
  async flushEmbedQueueForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.flushEmbedQueueForTest();
  }

  /** Trigger scheduled event completion cron — DEMO_MODE only (ROK-944). */
  @Post('trigger-scheduled-event-completion')
  @HttpCode(HttpStatus.OK)
  async triggerScheduledEventCompletionForTest(): Promise<{
    success: boolean;
  }> {
    return this.demoTestService.triggerScheduledEventCompletionForTest();
  }

  /** Pause the reconciliation cron to prevent API queue flooding — DEMO_MODE only (ROK-969). */
  @Post('pause-reconciliation')
  @HttpCode(HttpStatus.OK)
  async pauseReconciliationForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.pauseReconciliationForTest();
  }

  /** Enable Discord scheduled event creation -- DEMO_MODE only (ROK-969). */
  @Post('enable-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async enableScheduledEventsForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.enableScheduledEventsForTest();
  }

  /** Disable Discord scheduled event creation -- DEMO_MODE only (ROK-969). */
  @Post('disable-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async disableScheduledEventsForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.disableScheduledEventsForTest();
  }

  /** Delete all Discord scheduled events in the guild — DEMO_MODE only (ROK-969). */
  @Post('cleanup-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async cleanupScheduledEventsForTest() {
    return this.demoTestService.cleanupScheduledEventsForTest();
  }

  /** Wait for all BullMQ queues to drain — DEMO_MODE only. */
  @Post('await-processing')
  @HttpCode(HttpStatus.OK)
  async awaitProcessingForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(AwaitProcessingSchema, body ?? {});
    await this.demoTestService.awaitProcessingForTest(
      parsed.timeoutMs ?? 30_000,
    );
    return { success: true };
  }

  /** Inject a synthetic voice session — DEMO_MODE only (ROK-943 smoke test). */
  @Post('inject-voice-session')
  @HttpCode(HttpStatus.OK)
  async injectVoiceSessionForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(InjectVoiceSessionSchema, body);
    await this.demoTestService.injectVoiceSessionForTest(parsed);
    return { success: true };
  }

  /** Trigger voice classification for an event — DEMO_MODE only (ROK-943). */
  @Post('trigger-classify')
  @HttpCode(HttpStatus.OK)
  async triggerClassifyForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(TriggerClassifySchema, body);
    await this.demoTestService.triggerClassifyForTest(parsed.eventId);
    return { success: true };
  }

  /** Force-set event times bypassing Zod validation — DEMO_MODE only (ROK-969). */
  @Post('set-event-times')
  @HttpCode(HttpStatus.OK)
  async setEventTimesForTest(@Body() body: unknown) {
    const parsed = this.parseBody(SetEventTimesSchema, body);
    return this.demoTestService.setEventTimesForTest(
      parsed.eventId,
      parsed.startTime,
      parsed.endTime,
    );
  }

  /** Clear game interests for a user/game — DEMO_MODE only (ROK-966 smoke test). */
  @Post('clear-game-interest')
  @HttpCode(HttpStatus.OK)
  async clearGameInterestForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(ClearGameInterestSchema, body);
    await this.demoTestService.clearGameInterestForTest(
      parsed.userId,
      parsed.gameId,
    );
    return { success: true };
  }

  /** Set steamAppId on a game — DEMO_MODE only (ROK-966 smoke test). */
  @Post('set-steam-app-id')
  @HttpCode(HttpStatus.OK)
  async setSteamAppIdForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(SetSteamAppIdSchema, body);
    await this.demoTestService.setSteamAppIdForTest(
      parsed.gameId,
      parsed.steamAppId,
    );
    return { success: true };
  }

  /** Trigger steam nudge DMs for a lineup — DEMO_MODE only. */
  @Post('trigger-steam-nudge')
  @HttpCode(HttpStatus.OK)
  async triggerSteamNudge(
    @Body() body: { lineupId: number },
  ): Promise<{ success: boolean }> {
    await this.steamNudge.nudgeUnlinkedMembers(body.lineupId);
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

  /** Parse and validate body with a Zod schema, throwing 400 on failure. */
  private parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
      const messages = result.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new BadRequestException(`Validation failed: ${messages}`);
    }
    return result.data;
  }
}
