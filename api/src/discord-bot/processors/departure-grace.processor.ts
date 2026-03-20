import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SIGNUP_EVENTS } from '../discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot.constants';
import {
  DEPARTURE_GRACE_QUEUE,
  type DepartureGraceJobData,
} from '../queues/departure-grace.queue';
import {
  verifyEventStillLive,
  isDuringExtensionTime,
  verifySignupActive,
  moveToBench,
  notifyOrganizer,
  sendCreatorPromoteDM,
  isDepartureRelevant,
} from './departure-grace.helpers';

/**
 * BullMQ processor for the departure grace queue (ROK-596).
 *
 * When a member's grace period expires (they didn't rejoin voice):
 * 1. Verify the user is still NOT in voice
 * 2. Verify the event is still live
 * 3. Set signup status to 'departed'
 * 4. Move the roster assignment to bench (free the slot)
 * 5. Notify the event organizer (in-app)
 * 6. Send Discord DM to creator with Promote/Dismiss buttons
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
    private readonly clientService: DiscordBotClientService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  /** Bundled dependencies for extracted helper functions. */
  get deps() {
    return {
      db: this.db,
      logger: this.logger,
      voiceAttendanceService: this.voiceAttendanceService,
      notificationService: this.notificationService,
      clientService: this.clientService,
    };
  }

  async process(job: Job<DepartureGraceJobData>): Promise<void> {
    const { eventId, discordUserId, signupId } = job.data;
    const d = this.deps;

    this.logger.log(
      `Departure grace expired for user ${discordUserId} on event ${eventId}`,
    );

    if (d.voiceAttendanceService.isUserActive(eventId, discordUserId)) {
      this.logger.debug(
        `User ${discordUserId} rejoined voice for event ${eventId}, skipping`,
      );
      return;
    }

    const event = await verifyEventStillLive(d.db, eventId);
    if (!event) return;

    if (isDuringExtensionTime(event)) {
      this.logger.debug(
        `Departure during extension time for event ${eventId}, skipping`,
      );
      return;
    }

    const signup = await verifySignupActive(d.db, signupId, eventId);
    if (!signup) return;

    await this.applyDeparture(event, signup, eventId, discordUserId);
  }

  /** Apply departure status, bench move, notifications, and emit events. */
  private async applyDeparture(
    event: typeof schema.events.$inferSelect,
    signup: typeof schema.eventSignups.$inferSelect,
    eventId: number,
    discordUserId: string,
  ): Promise<void> {
    const d = this.deps;

    await d.db
      .update(schema.eventSignups)
      .set({ status: 'departed' })
      .where(eq(schema.eventSignups.id, signup.id));

    const assignment = await moveToBench(d.db, signup.id, eventId, d.logger);
    const vacatedRole = assignment?.role ?? null;
    const relevant = await isDepartureRelevant(d.db, event, vacatedRole);

    if (relevant) {
      const displayName = await this.resolveDisplayName(signup);
      await notifyOrganizer(d, event, eventId, displayName);
      if (assignment && vacatedRole && vacatedRole !== 'bench') {
        await sendCreatorPromoteDM(d, event, displayName, assignment);
      }
    }

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
