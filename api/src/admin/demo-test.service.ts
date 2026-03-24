import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { NOTIFICATION_TYPES } from '../drizzle/schema/notification-preferences';
import type { ChannelPrefs } from '../drizzle/schema/notification-preferences';
import type { SignupStatus } from '../drizzle/schema/event-signups';
import type { CreateSignupDto, SignupResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { SignupsService } from '../events/signups.service';
import { SignupsRosterService } from '../events/signups-roster.service';
import { DepartureGraceQueueService } from '../discord-bot/queues/departure-grace.queue';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { QueueHealthService } from '../queue/queue-health.service';
import { ScheduledEventService } from '../discord-bot/services/scheduled-event.service';
import {
  classifyEventSessions,
  autoPopulateAttendance,
} from '../discord-bot/services/voice-attendance-classify.helpers';
import {
  triggerScheduledEventCreate,
  type ScheduledEventCreateResult,
} from './demo-test-scheduled-event.helpers';

/**
 * Service for demo/test-only endpoints used by smoke tests.
 * All methods require DEMO_MODE to be enabled (both env and DB flag).
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
    // Clear the Discord ID from any other user first (avoids unique constraint
    // when multiple CI smoke categories re-run setup with different dmRecipient)
    await this.db
      .update(schema.users)
      .set({ discordId: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.users.discordId, discordId),
          sql`${schema.users.id} != ${userId}`,
        ),
      );
    const [updated] = await this.db
      .update(schema.users)
      .set({ discordId, username, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /** Enable Discord DM notifications for a user -- DEMO_MODE only. */
  async enableDiscordNotificationsForTest(userId: number): Promise<void> {
    await this.assertDemoMode();
    const prefs = this.buildAllChannelsEnabled();
    await this.db
      .insert(schema.userNotificationPreferences)
      .values({ userId, channelPrefs: prefs })
      .onConflictDoUpdate({
        target: schema.userNotificationPreferences.userId,
        set: { channelPrefs: prefs },
      });
  }

  /** Add a game interest for a user -- DEMO_MODE only (for smoke tests). */
  async addGameInterestForTest(userId: number, gameId: number): Promise<void> {
    await this.assertDemoMode();
    await this.db
      .insert(schema.gameInterests)
      .values({ userId, gameId, source: 'manual' })
      .onConflictDoNothing();
  }

  /** Create a signup for any user -- DEMO_MODE only (for smoke tests). */
  async createSignupForTest(
    eventId: number,
    userId: number,
    dto?: {
      preferredRoles?: string[];
      characterId?: string;
      status?: SignupStatus;
      linkDiscord?: boolean;
    },
  ): Promise<SignupResponseDto> {
    await this.assertDemoMode();
    const svc = this.moduleRef.get(SignupsService, { strict: false });
    const signupDto = this.buildSignupDto(dto);
    const result = await svc.signup(eventId, userId, signupDto);
    if (dto?.linkDiscord) {
      await this.linkSignupDiscordId(result.id, userId);
    }
    if (dto?.status && dto.status !== 'signed_up') {
      await this.overrideSignupStatus(result.id, dto.status);
    }
    return result;
  }

  /** Enqueue a departure grace job with 0ms delay — DEMO_MODE only. */
  async triggerDepartureForTest(
    eventId: number,
    signupId: number,
    discordUserId: string,
  ): Promise<void> {
    await this.assertDemoMode();
    const queueSvc = this.moduleRef.get(DepartureGraceQueueService, {
      strict: false,
    });
    await queueSvc.enqueue({ eventId, signupId, discordUserId }, 0);
  }

  /** Query a user's notifications — DEMO_MODE only (smoke tests). */
  async getNotificationsForTest(
    userId: number,
    type?: string,
    limit = 20,
  ): Promise<(typeof schema.notifications.$inferSelect)[]> {
    await this.assertDemoMode();
    const conditions = [eq(schema.notifications.userId, userId)];
    if (type) {
      conditions.push(sql`${schema.notifications.type} = ${type}`);
    }
    return this.db
      .select()
      .from(schema.notifications)
      .where(and(...conditions))
      .orderBy(sql`${schema.notifications.createdAt} DESC`)
      .limit(limit);
  }

  /** Cancel a signup as if the user did it — triggers bufferLeave. */
  async cancelSignupForTest(eventId: number, userId: number): Promise<void> {
    await this.assertDemoMode();
    const svc = this.moduleRef.get(SignupsRosterService, { strict: false });
    await svc.cancel(eventId, userId);
  }

  /** Flush the roster notification buffer and return pending count. */
  async flushNotificationBufferForTest(): Promise<number> {
    await this.assertDemoMode();
    const buf = this.moduleRef.get(RosterNotificationBufferService, {
      strict: false,
    });
    const count = buf.pendingCount;
    await buf.flushAll();
    return count;
  }

  /** Flush voice attendance sessions to DB — DEMO_MODE only. */
  async flushVoiceSessionsForTest(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const svc = this.moduleRef.get(VoiceAttendanceService, {
      strict: false,
    });
    await svc.flushToDb();
    return { success: true };
  }

  /** Drain the embed sync BullMQ queue — DEMO_MODE only. */
  async flushEmbedQueueForTest(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const qhs = this.moduleRef.get(QueueHealthService, { strict: false });
    await qhs.drainAll();
    return { success: true };
  }

  /** Trigger scheduled event completion cron — DEMO_MODE only (ROK-944). */
  async triggerScheduledEventCompletionForTest(): Promise<{
    success: boolean;
  }> {
    await this.assertDemoMode();
    const svc = this.moduleRef.get(ScheduledEventService, { strict: false });
    await svc.completeExpiredEvents();
    return { success: true };
  }

  /** Trigger Discord scheduled event creation for an event — DEMO_MODE only. */
  async triggerScheduledEventCreateForTest(
    eventId: number,
  ): Promise<ScheduledEventCreateResult> {
    await this.assertDemoMode();
    return triggerScheduledEventCreate(this.db, this.moduleRef, eventId);
  }

  /** Wait for all BullMQ queues to drain — DEMO_MODE only. */
  async awaitProcessingForTest(timeoutMs = 30_000): Promise<void> {
    await this.assertDemoMode();
    const qhs = this.moduleRef.get(QueueHealthService, { strict: false });
    await qhs.awaitDrained(timeoutMs);
  }

  /** Inject a synthetic voice session — DEMO_MODE only (ROK-943 smoke test). */
  async injectVoiceSessionForTest(p: {
    eventId: number;
    discordUserId: string;
    userId: number;
    durationSec: number;
    firstJoinAt?: string;
    lastLeaveAt?: string;
  }): Promise<void> {
    await this.assertDemoMode();
    const leave = p.lastLeaveAt ? new Date(p.lastLeaveAt) : new Date();
    const join = p.firstJoinAt
      ? new Date(p.firstJoinAt)
      : new Date(leave.getTime() - p.durationSec * 1000);
    await this.db
      .insert(schema.eventVoiceSessions)
      .values({
        eventId: p.eventId,
        userId: p.userId,
        discordUserId: p.discordUserId,
        discordUsername: 'smoke-test',
        firstJoinAt: join,
        lastLeaveAt: leave,
        totalDurationSec: p.durationSec,
        segments: [
          {
            joinAt: join.toISOString(),
            leaveAt: leave.toISOString(),
            durationSec: p.durationSec,
          },
        ],
      })
      .onConflictDoNothing();
  }

  /** Trigger voice classification + attendance for an event — DEMO_MODE only (ROK-943). */
  async triggerClassifyForTest(eventId: number): Promise<void> {
    await this.assertDemoMode();
    const logger = { log: () => {}, warn: () => {} };
    const defaultGraceMs = 5 * 60 * 1000;
    await classifyEventSessions(
      this.db,
      eventId,
      undefined,
      defaultGraceMs,
      logger,
    );
    await autoPopulateAttendance(this.db, eventId, logger);
  }

  /** Copy the user's discordId onto their signup row (for voice classification). */
  private async linkSignupDiscordId(
    signupId: number,
    userId: number,
  ): Promise<void> {
    const [user] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (user?.discordId) {
      await this.db
        .update(schema.eventSignups)
        .set({ discordUserId: user.discordId })
        .where(eq(schema.eventSignups.id, signupId));
    }
  }

  /** Directly update a signup's status in the DB. */
  private async overrideSignupStatus(
    signupId: number,
    status: SignupStatus,
  ): Promise<void> {
    await this.db
      .update(schema.eventSignups)
      .set({ status })
      .where(eq(schema.eventSignups.id, signupId));
  }

  /** Build a CreateSignupDto, filtering preferredRoles to valid values. */
  private buildSignupDto(dto?: {
    preferredRoles?: string[];
    characterId?: string;
  }): CreateSignupDto | undefined {
    if (!dto) return undefined;
    const validRoles = new Set(['tank', 'healer', 'dps']);
    const filtered = dto.preferredRoles?.filter((r) =>
      validRoles.has(r),
    ) as CreateSignupDto['preferredRoles'];
    return {
      preferredRoles: filtered?.length ? filtered : undefined,
      characterId: dto.characterId,
    };
  }

  /** Build a ChannelPrefs object with all channels enabled for all types. */
  private buildAllChannelsEnabled(): ChannelPrefs {
    const prefs = {} as Record<string, Record<string, boolean>>;
    for (const type of NOTIFICATION_TYPES) {
      prefs[type] = { inApp: true, push: true, discord: true };
    }
    return prefs as ChannelPrefs;
  }
}
