import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { SIGNUP_EVENTS } from '../discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot.constants';
import { findFirstAvailableSlot } from '../../events/roster-slot.utils';
import {
  DepartureGraceQueueService,
  DEPARTURE_GRACE_DELAY_MS,
} from '../queues/departure-grace.queue';

/**
 * Orchestrator for mid-event departure handling (ROK-596).
 *
 * Manages grace timers when members leave voice during live scheduled events.
 * Handles priority rejoin when a departed member returns.
 */
@Injectable()
export class DepartureGraceService {
  private readonly logger = new Logger(DepartureGraceService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly graceQueue: DepartureGraceQueueService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Called when a member leaves voice during a live scheduled event.
   * Starts a grace timer if the member has an active signup.
   */
  async onMemberLeave(eventId: number, discordUserId: string): Promise<void> {
    try {
      const shouldSkip = await this.isAdHocEvent(eventId);
      if (shouldSkip) return;

      const signup = await this.findActiveSignup(eventId, discordUserId);
      if (!signup) return;

      if (this.isTerminalStatus(signup.status)) return;

      await this.graceQueue.enqueue(
        { eventId, discordUserId, signupId: signup.id },
        DEPARTURE_GRACE_DELAY_MS,
      );
      this.logger.debug(
        `Started departure grace timer for user ${discordUserId} on event ${eventId}`,
      );
    } catch (error) {
      this.logError('leave', discordUserId, eventId, error);
    }
  }

  /**
   * Called when a member joins/rejoins voice during a live scheduled event.
   * Cancels any pending grace timer, or triggers priority rejoin if already departed.
   */
  async onMemberRejoin(eventId: number, discordUserId: string): Promise<void> {
    try {
      await this.graceQueue.cancel(eventId, discordUserId);

      const signup = await this.findSignupByStatus(
        eventId,
        discordUserId,
        'departed',
      );
      if (signup) {
        await this.handlePriorityRejoin(eventId, discordUserId, signup);
      }
    } catch (error) {
      this.logError('rejoin', discordUserId, eventId, error);
    }
  }

  // ─── Priority Rejoin ───────────────────────────────────

  /**
   * Restore a departed member's signup and try to reassign their roster slot.
   */
  private async handlePriorityRejoin(
    eventId: number,
    discordUserId: string,
    signup: typeof schema.eventSignups.$inferSelect,
  ): Promise<void> {
    await this.restoreSignup(signup.id);

    const assignedSlot = await this.tryRosterReassignment(eventId, signup.id);
    const displayName = await this.resolveDisplayName(signup);

    await this.notifyRejoin(eventId, displayName, assignedSlot);
    this.emitRejoinEvent(eventId, signup);

    this.logger.log(
      `Priority rejoin: user ${discordUserId} reassigned to roster for event ${eventId}`,
    );
  }

  private async restoreSignup(signupId: number): Promise<void> {
    await this.db
      .update(schema.eventSignups)
      .set({ status: 'signed_up' })
      .where(eq(schema.eventSignups.id, signupId));
  }

  private async notifyRejoin(
    eventId: number,
    displayName: string,
    assignedSlot: { role: string; position: number } | null,
  ): Promise<void> {
    const [event] = await this.db
      .select({
        creatorId: schema.events.creatorId,
        title: schema.events.title,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event?.creatorId) return;

    const slotInfo = assignedSlot
      ? ` (${assignedSlot.role}:${assignedSlot.position})`
      : ' (bench/unassigned)';

    const payload = await this.buildNotificationPayload(eventId);

    await this.notificationService.create({
      userId: event.creatorId,
      type: 'member_returned',
      title: 'Member Returned',
      message: `${displayName} returned — reassigned to roster${slotInfo} for "${event.title}"`,
      payload,
    });
  }

  private async buildNotificationPayload(
    eventId: number,
  ): Promise<Record<string, unknown>> {
    const discordUrl =
      await this.notificationService.getDiscordEmbedUrl(eventId);
    const voiceChannelId =
      await this.notificationService.resolveVoiceChannelForEvent(eventId);
    return {
      eventId,
      ...(discordUrl ? { discordUrl } : {}),
      ...(voiceChannelId ? { voiceChannelId } : {}),
    };
  }

  private emitRejoinEvent(
    eventId: number,
    signup: typeof schema.eventSignups.$inferSelect,
  ): void {
    this.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId: signup.userId,
      signupId: signup.id,
      action: 'priority_rejoin',
    } satisfies SignupEventPayload);
  }

  // ─── Roster Reassignment ──────────────────────────────

  /**
   * Attempt to reassign a returning member from bench back to a roster slot.
   */
  private async tryRosterReassignment(
    eventId: number,
    signupId: number,
  ): Promise<{ role: string; position: number } | null> {
    const benchAssignment = await this.findBenchAssignment(signupId);
    if (!benchAssignment) return null;

    const availableSlot = await this.findAvailableSlot(
      eventId,
      benchAssignment.id,
    );
    if (!availableSlot) return null;

    await this.reassignSlot(benchAssignment.id, availableSlot);
    return availableSlot;
  }

  private async findBenchAssignment(
    signupId: number,
  ): Promise<{ id: number } | null> {
    const [row] = await this.db
      .select({ id: schema.rosterAssignments.id })
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.signupId, signupId),
          eq(schema.rosterAssignments.role, 'bench'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async findAvailableSlot(
    eventId: number,
    excludeAssignmentId: number,
  ): Promise<{ role: string; position: number } | null> {
    const [event] = await this.db
      .select({ slotConfig: schema.events.slotConfig })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event) return null;

    const currentAssignments = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));

    const occupiedSlots = new Set(
      currentAssignments
        .filter((a) => a.id !== excludeAssignmentId)
        .map((a) => `${a.role}:${a.position}`),
    );

    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    return findFirstAvailableSlot(slotConfig, occupiedSlots);
  }

  private async reassignSlot(
    assignmentId: number,
    slot: { role: string; position: number },
  ): Promise<void> {
    await this.db
      .update(schema.rosterAssignments)
      .set({ role: slot.role, position: slot.position })
      .where(eq(schema.rosterAssignments.id, assignmentId));
  }

  // ─── Signup Lookups ───────────────────────────────────

  /**
   * Find a user's active signup for an event.
   */
  private async findActiveSignup(
    eventId: number,
    discordUserId: string,
  ): Promise<typeof schema.eventSignups.$inferSelect | undefined> {
    const direct = await this.findSignupByDiscordId(eventId, discordUserId);
    if (direct) return direct;

    return this.findSignupViaLinkedUser(eventId, discordUserId);
  }

  /**
   * Find a signup with a specific status.
   */
  private async findSignupByStatus(
    eventId: number,
    discordUserId: string,
    status: string,
  ): Promise<typeof schema.eventSignups.$inferSelect | undefined> {
    const direct = await this.findSignupByDiscordId(
      eventId,
      discordUserId,
      status,
    );
    if (direct) return direct;

    return this.findSignupViaLinkedUser(eventId, discordUserId, status);
  }

  private async findSignupByDiscordId(
    eventId: number,
    discordUserId: string,
    status?: string,
  ): Promise<typeof schema.eventSignups.$inferSelect | undefined> {
    const conditions = [
      eq(schema.eventSignups.eventId, eventId),
      eq(schema.eventSignups.discordUserId, discordUserId),
    ];
    if (status) conditions.push(eq(schema.eventSignups.status, status));

    const [match] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(and(...conditions))
      .limit(1);
    return match;
  }

  private async findSignupViaLinkedUser(
    eventId: number,
    discordUserId: string,
    status?: string,
  ): Promise<typeof schema.eventSignups.$inferSelect | undefined> {
    const userId = await this.resolveUserId(discordUserId);
    if (!userId) return undefined;

    const conditions = [
      eq(schema.eventSignups.eventId, eventId),
      eq(schema.eventSignups.userId, userId),
    ];
    if (status) conditions.push(eq(schema.eventSignups.status, status));

    const [match] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(and(...conditions))
      .limit(1);
    return match;
  }

  // ─── Utilities ────────────────────────────────────────

  private async isAdHocEvent(eventId: number): Promise<boolean> {
    const [event] = await this.db
      .select({ isAdHoc: schema.events.isAdHoc })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return !event || event.isAdHoc;
  }

  private isTerminalStatus(status: string): boolean {
    return (
      status === 'departed' || status === 'declined' || status === 'roached_out'
    );
  }

  private async resolveUserId(discordUserId: string): Promise<number | null> {
    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);
    return user?.id ?? null;
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

  private logError(
    action: string,
    discordUserId: string,
    eventId: number,
    error: unknown,
  ): void {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(
      `Failed to handle member ${action} for ${discordUserId} on event ${eventId}: ${msg}`,
    );
  }
}
