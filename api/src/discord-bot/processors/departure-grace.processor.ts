import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { BenchPromotionService } from '../../events/bench-promotion.service';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { SIGNUP_EVENTS } from '../discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot.constants';
import {
  DEPARTURE_GRACE_QUEUE,
  type DepartureGraceJobData,
} from '../queues/departure-grace.queue';

/**
 * BullMQ processor for the departure grace queue (ROK-596).
 *
 * When a member's grace period expires (they didn't rejoin voice):
 * 1. Verify the user is still NOT in voice
 * 2. Verify the event is still live
 * 3. Set signup status to 'departed'
 * 4. Delete the roster assignment (free the slot)
 * 5. Notify the event organizer
 * 6. Schedule bench promotion for the vacated slot
 * 7. Emit events for Discord embed + WebSocket sync
 */
@Processor(DEPARTURE_GRACE_QUEUE)
export class DepartureGraceProcessor extends WorkerHost {
  private readonly logger = new Logger(DepartureGraceProcessor.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly voiceAttendanceService: VoiceAttendanceService,
    private readonly notificationService: NotificationService,
    private readonly benchPromotionService: BenchPromotionService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<DepartureGraceJobData>): Promise<void> {
    const { eventId, discordUserId, signupId } = job.data;

    this.logger.log(
      `Departure grace expired for user ${discordUserId} on event ${eventId}`,
    );

    // 1. Re-verify the user is still NOT in voice
    if (this.voiceAttendanceService.isUserActive(eventId, discordUserId)) {
      this.logger.debug(
        `User ${discordUserId} rejoined voice for event ${eventId}, skipping departure`,
      );
      return;
    }

    // 2. Verify the event is still live (scheduled, not cancelled, within duration window)
    const now = new Date();
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.id, eventId),
          eq(schema.events.isAdHoc, false),
          sql`${schema.events.cancelledAt} IS NULL`,
          sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
        ),
      )
      .limit(1);

    if (!event) {
      this.logger.debug(
        `Event ${eventId} is no longer live, skipping departure for ${discordUserId}`,
      );
      return;
    }

    // 3. Verify the signup still exists and is in an active status
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.id, signupId),
          eq(schema.eventSignups.eventId, eventId),
        ),
      )
      .limit(1);

    if (!signup) {
      this.logger.debug(
        `Signup ${signupId} not found for event ${eventId}, skipping departure`,
      );
      return;
    }

    if (signup.status !== 'signed_up' && signup.status !== 'tentative') {
      this.logger.debug(
        `Signup ${signupId} status is '${signup.status}', skipping departure`,
      );
      return;
    }

    // 4. Update signup status to 'departed'
    await this.db
      .update(schema.eventSignups)
      .set({ status: 'departed' })
      .where(eq(schema.eventSignups.id, signupId));

    // 5. Move the user's roster assignment to bench (free their slot visually)
    const [assignment] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signupId))
      .limit(1);

    if (assignment && assignment.role !== 'bench') {
      // Find next available bench position
      const benchSlots = await this.db
        .select({ position: schema.rosterAssignments.position })
        .from(schema.rosterAssignments)
        .where(
          and(
            eq(schema.rosterAssignments.eventId, eventId),
            eq(schema.rosterAssignments.role, 'bench'),
          ),
        );
      const nextBenchPos =
        benchSlots.reduce((max, r) => Math.max(max, r.position), 0) + 1;

      await this.db
        .update(schema.rosterAssignments)
        .set({ role: 'bench', position: nextBenchPos })
        .where(eq(schema.rosterAssignments.id, assignment.id));

      this.logger.log(
        `Moved user ${discordUserId} from ${assignment.role}:${assignment.position} to bench:${nextBenchPos} for event ${eventId} (departed)`,
      );
    }

    // 6. Resolve display name for the notification
    const displayName = await this.resolveDisplayName(signup);

    // 7. Notify the event organizer
    if (event.creatorId) {
      const discordUrl =
        await this.notificationService.getDiscordEmbedUrl(eventId);
      const voiceChannelId =
        await this.notificationService.resolveVoiceChannelForEvent(eventId);

      await this.notificationService.create({
        userId: event.creatorId,
        type: 'slot_vacated',
        title: 'Member Departed',
        message: `${displayName} departed — slot freed for "${event.title}"`,
        payload: {
          eventId,
          ...(discordUrl ? { discordUrl } : {}),
          ...(voiceChannelId ? { voiceChannelId } : {}),
        },
      });
    }

    // 8. Schedule bench promotion for the vacated non-bench slot
    if (
      assignment &&
      assignment.role &&
      assignment.role !== 'bench' &&
      (await this.benchPromotionService.isEligible(eventId))
    ) {
      await this.benchPromotionService.schedulePromotion(
        eventId,
        assignment.role,
        assignment.position,
      );
    }

    // 9. Emit signup event so Discord embed is re-synced
    this.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId: signup.userId,
      signupId: signup.id,
      action: 'departed',
    } satisfies SignupEventPayload);

    this.logger.log(
      `User ${discordUserId} marked as departed for event ${eventId}`,
    );
  }

  private async resolveDisplayName(
    signup: typeof schema.eventSignups.$inferSelect,
  ): Promise<string> {
    if (signup.discordUsername) return signup.discordUsername;
    if (signup.userId) {
      const [user] = await this.db
        .select({ username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.id, signup.userId))
        .limit(1);
      if (user) return user.username;
    }
    return signup.discordUserId ?? 'Unknown';
  }
}
