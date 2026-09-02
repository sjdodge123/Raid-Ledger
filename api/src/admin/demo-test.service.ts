import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { SignupResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import {
  enableScheduledEventsForTest as enableSE,
  disableScheduledEventsForTest as disableSE,
  cleanupScheduledEventsForTest as cleanupSE,
  pauseReconciliationForTest as pauseRecon,
  triggerReconciliationForTest as triggerRecon,
  triggerScheduledEventCompletionForTest as triggerSECompletion,
  setEventTimesForTest as setTimes,
  type CleanupSEResult,
} from './demo-test-scheduled-event.helpers';
import {
  injectVoiceSessionForTest as injectVoice,
  triggerClassifyForTest as triggerClassify,
  flushVoiceSessionsForTest as flushVoice,
  type InjectVoiceSessionParams,
} from './demo-test-voice.helpers';
import {
  addGameInterestForTest as addGameInterest,
  clearGameInterestForTest as clearGameInterest,
  setSteamAppIdForTest as setSteamAppId,
  getGameForTest as getGame,
  setAutoHeartPrefForTest as setAutoHeartPref,
} from './demo-test-steam.helpers';
import {
  seedCooptimusFixtures,
  type CooptimusSeedResult,
} from './demo-test-cooptimus.helpers';
import {
  createSignupForTest as createSignup,
  triggerDepartureForTest as triggerDeparture,
  cancelSignupForTest as cancelSignup,
  type CreateSignupForTestDto,
} from './demo-test-signups.helpers';
import {
  linkDiscordForTest as linkDiscord,
  enableDiscordNotificationsForTest as enableDiscordNotifications,
  getNotificationsForTest as getNotifications,
  clearGameTimeConfirmationForTest as clearGameTimeConfirmation,
  flushNotificationBufferForTest as flushNotificationBuffer,
  flushEmbedQueueForTest as flushEmbedQueue,
  awaitProcessingForTest as awaitProcessing,
} from './demo-test-core.helpers';
import { cancelLineupPhaseJobsForTest as cancelLineupPhaseJobs } from './demo-test-lineup.helpers';

/**
 * Thin facade for demo/test-only endpoints used by smoke tests (ROK-1072).
 * All methods require DEMO_MODE to be enabled (both env and DB flag); the
 * actual logic lives in per-domain `demo-test-*.helpers.ts` files.
 */
@Injectable()
export class DemoTestService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Assert that DEMO_MODE is enabled in both process.env and DB settings.
   * Throws ForbiddenException if either check fails.
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

  /** Link a Discord ID to a user -- DEMO_MODE only (for smoke tests). */
  async linkDiscordForTest(
    userId: number,
    discordId: string,
    username: string,
  ): Promise<typeof schema.users.$inferSelect | undefined> {
    await this.assertDemoMode();
    return linkDiscord(this.db, userId, discordId, username);
  }

  /** Enable Discord DM notifications for a user -- DEMO_MODE only. */
  async enableDiscordNotificationsForTest(userId: number): Promise<void> {
    await this.assertDemoMode();
    await enableDiscordNotifications(this.db, userId);
  }

  /** Add a game interest for a user -- DEMO_MODE only (for smoke tests). */
  async addGameInterestForTest(
    userId: number,
    gameId: number,
    source: string = 'manual',
  ): Promise<void> {
    await this.assertDemoMode();
    await addGameInterest(this.db, userId, gameId, source);
  }

  /** Create a signup for any user -- DEMO_MODE only (for smoke tests). */
  async createSignupForTest(
    eventId: number,
    userId: number,
    dto?: CreateSignupForTestDto,
  ): Promise<SignupResponseDto> {
    await this.assertDemoMode();
    return createSignup(this.moduleRef, this.db, eventId, userId, dto);
  }

  /** Enqueue a departure grace job with 0ms delay — DEMO_MODE only. */
  async triggerDepartureForTest(
    eventId: number,
    signupId: number,
    discordUserId: string,
  ): Promise<void> {
    await this.assertDemoMode();
    await triggerDeparture(this.moduleRef, eventId, signupId, discordUserId);
  }

  /** Query a user's notifications — DEMO_MODE only (smoke tests). */
  async getNotificationsForTest(
    userId: number,
    type?: string,
    limit = 20,
  ): Promise<(typeof schema.notifications.$inferSelect)[]> {
    await this.assertDemoMode();
    return getNotifications(this.db, userId, type, limit);
  }

  /** Cancel a signup as if the user did it — triggers bufferLeave. */
  async cancelSignupForTest(eventId: number, userId: number): Promise<void> {
    await this.assertDemoMode();
    await cancelSignup(this.moduleRef, eventId, userId);
  }

  /** Flush the roster notification buffer and return pending count. */
  async flushNotificationBufferForTest(): Promise<number> {
    await this.assertDemoMode();
    return flushNotificationBuffer(this.moduleRef);
  }

  /** Flush voice attendance sessions to DB — DEMO_MODE only. */
  async flushVoiceSessionsForTest(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    return flushVoice(this.moduleRef);
  }

  /** Drain the embed sync BullMQ queue — DEMO_MODE only. */
  async flushEmbedQueueForTest(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    return flushEmbedQueue(this.moduleRef);
  }

  /** Trigger scheduled event completion cron — DEMO_MODE only (ROK-944). */
  async triggerScheduledEventCompletionForTest(): Promise<{
    success: boolean;
  }> {
    await this.assertDemoMode();
    return triggerSECompletion(this.moduleRef);
  }

  /** Enable Discord scheduled event creation -- DEMO_MODE only (ROK-969). */
  async enableScheduledEventsForTest(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    return enableSE(this.moduleRef);
  }

  /** Disable Discord scheduled event creation -- DEMO_MODE only (ROK-969). */
  async disableScheduledEventsForTest(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    return disableSE(this.moduleRef);
  }

  /** Delete all Discord scheduled events in the guild — DEMO_MODE only (ROK-969). */
  async cleanupScheduledEventsForTest(): Promise<CleanupSEResult> {
    await this.assertDemoMode();
    return cleanupSE(this.moduleRef);
  }

  /** Pause the reconciliation cron — DEMO_MODE only (ROK-969/1347). */
  async pauseReconciliationForTest(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    return pauseRecon(this.moduleRef);
  }

  /** Run the reconciliation cron once — DEMO_MODE only (ROK-1347). */
  async triggerReconciliationForTest(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    return triggerRecon(this.moduleRef);
  }

  /** Wait for all BullMQ queues to drain — DEMO_MODE only. */
  async awaitProcessingForTest(timeoutMs = 30_000): Promise<void> {
    await this.assertDemoMode();
    await awaitProcessing(this.moduleRef, timeoutMs);
  }

  /** Inject a synthetic voice session — DEMO_MODE only (ROK-943 smoke test). */
  async injectVoiceSessionForTest(p: InjectVoiceSessionParams): Promise<void> {
    await this.assertDemoMode();
    await injectVoice(this.db, p);
  }

  /** Trigger voice classification + attendance for an event — DEMO_MODE only (ROK-943). */
  async triggerClassifyForTest(eventId: number): Promise<void> {
    await this.assertDemoMode();
    await triggerClassify(this.db, eventId);
  }

  /** Force-set event times bypassing Zod validation — DEMO_MODE only (ROK-969). */
  async setEventTimesForTest(id: number, start: string, end: string) {
    await this.assertDemoMode();
    return setTimes(this.db, id, start, end);
  }

  /** Clear game interests for a user/game — DEMO_MODE only (ROK-966 smoke test). */
  async clearGameInterestForTest(
    userId: number,
    gameId: number,
  ): Promise<void> {
    await this.assertDemoMode();
    await clearGameInterest(this.db, userId, gameId);
  }

  /** Set steamAppId on a game — DEMO_MODE only (ROK-966 smoke test). */
  async setSteamAppIdForTest(
    gameId: number,
    steamAppId: number,
  ): Promise<void> {
    await this.assertDemoMode();
    await setSteamAppId(this.db, gameId, steamAppId);
  }

  /** Fetch a game by id (for smoke-test fixture setup) — DEMO_MODE only (ROK-1054). */
  async getGameForTest(id: number) {
    await this.assertDemoMode();
    return getGame(this.db, id);
  }

  /** Seed the Co-Optimus co-op UI-state fixtures — DEMO_MODE only (ROK-1398). */
  async seedCooptimusForTest(): Promise<CooptimusSeedResult> {
    await this.assertDemoMode();
    return seedCooptimusFixtures(this.db);
  }

  /** Set the autoHeartSteamUrls preference for a user — DEMO_MODE only (ROK-1054). */
  async setAutoHeartPrefForTest(
    userId: number,
    enabled: boolean,
  ): Promise<void> {
    await this.assertDemoMode();
    await setAutoHeartPref(this.db, userId, enabled);
  }

  /** Clear game_time_confirmed_at for a user -- DEMO_MODE only (ROK-999). */
  async clearGameTimeConfirmationForTest(userId: number): Promise<void> {
    await this.assertDemoMode();
    await clearGameTimeConfirmation(this.db, userId);
  }

  /** Cancel all pending BullMQ phase-transition jobs for a lineup — DEMO_MODE only. */
  async cancelLineupPhaseJobsForTest(lineupId: number): Promise<number> {
    await this.assertDemoMode();
    return cancelLineupPhaseJobs(this.moduleRef, lineupId);
  }
}
